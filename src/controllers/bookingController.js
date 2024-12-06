const Route = require('../models/Route');
const RouteSchedule = require('../models/RouteSchedule');
const Booking = require('../models/Booking');
const catchAsync = require('../utils/catchAsync');
const Openrouteservice = require('openrouteservice-js');

const orsDirections = new Openrouteservice.Directions({
    api_key: process.env.OPENROUTE_API_KEY
});

const orsGeocoding = new Openrouteservice.Geocode({
    api_key: process.env.OPENROUTE_API_KEY
});

exports.searchAvailableRoutes = catchAsync(async (req, res) => {
    const { fromLocation, toLocation, date, passengers = 1 } = req.body;

    if (!fromLocation || !toLocation || !date) {
        return res.status(400).json({
            status: 'fail',
            message: 'Please provide fromLocation, toLocation and date'
        });
    }

    // Convert the search date to start and end of day for comparison
    const searchDate = new Date(date);
    searchDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(searchDate);
    nextDate.setDate(nextDate.getDate() + 1);

    console.log('Searching for routes between:', {
        searchDate,
        nextDate,
        fromLocation,
        toLocation
    });

    // Find routes with available schedules
    const availableRoutes = await Route.aggregate([
        {
            $match: {
                'startLocation.address': fromLocation,
                'endLocation.address': toLocation,
                status: 'active'
            }
        },
        {
            $lookup: {
                from: 'routeschedules',
                let: { routeId: '$_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ['$routeId', '$$routeId'] },
                                    { $gte: ['$date', searchDate] },
                                    { $lt: ['$date', nextDate] },
                                    { $gte: ['$availableSeats', passengers] },
                                    { $eq: ['$status', 'active'] }
                                ]
                            }
                        }
                    }
                ],
                as: 'schedule'
            }
        },
        {
            $unwind: {
                path: '$schedule',
                preserveNullAndEmptyArrays: false
            }
        },
        {
            $lookup: {
                from: 'cars',
                localField: 'carId',
                foreignField: '_id',
                as: 'car'
            }
        },
        {
            $unwind: '$car'
        },
        {
            $project: {
                name: 1,
                startLocation: 1,
                endLocation: 1,
                car: {
                    _id: 1,
                    model: 1,
                    registrationNumber: 1
                },
                schedule: {
                    _id: 1,
                    date: 1,
                    availableSeats: 1,
                    pricePerSeat: 1,
                    totalSeats: 1
                },
                totalPrice: {
                    $multiply: ['$schedule.pricePerSeat', passengers]
                }
            }
        }
    ]);

    console.log('Found routes:', availableRoutes);

    res.status(200).json({
        status: 'success',
        results: availableRoutes.length,
        data: {
            routes: availableRoutes
        }
    });
});

exports.createBooking = catchAsync(async (req, res) => {
    const {
        routeId,
        routeScheduleId,
        carId,
        passengers,
        selectedSeats
    } = req.body;

    // 1. Validate input
    if (!routeId || !routeScheduleId || !carId || !passengers || !selectedSeats) {
        return res.status(400).json({
            status: 'fail',
            message: 'Please provide all required booking details'
        });
    }

    // 2. Check if number of passengers matches selected seats
    if (passengers.length !== selectedSeats.length) {
        return res.status(400).json({
            status: 'fail',
            message: 'Number of passengers must match number of selected seats'
        });
    }

    // 3. Get route schedule and check availability
    const schedule = await RouteSchedule.findById(routeScheduleId);
    
    if (!schedule) {
        return res.status(404).json({
            status: 'fail',
            message: 'Schedule not found'
        });
    }

    // 4. Check if schedule is active
    if (schedule.status !== 'active') {
        return res.status(400).json({
            status: 'fail',
            message: 'This schedule is not active for booking'
        });
    }

    // 5. Check if enough seats are available
    if (schedule.availableSeats < passengers.length) {
        return res.status(400).json({
            status: 'fail',
            message: 'Not enough seats available'
        });
    }

    // 6. Verify selected seats are available
    const unavailableSeats = schedule.seatLayout.filter(
        seat => selectedSeats.includes(seat.seatNumber) && seat.isBooked
    );

    if (unavailableSeats.length > 0) {
        return res.status(400).json({
            status: 'fail',
            message: `Seats ${unavailableSeats.map(s => s.seatNumber).join(', ')} are already booked`
        });
    }

    // 7. Calculate total amount
    const totalAmount = passengers.length * schedule.pricePerSeat;

    // 8. Create booking with carId
    const booking = await Booking.create({
        userId: req.user.id,
        routeId,
        routeScheduleId,
        carId,
        passengers,
        selectedSeats,
        totalAmount,
        status: 'confirmed',
        paymentStatus: 'pending'
    });

    // 9. Update seat availability in schedule
    await RouteSchedule.findByIdAndUpdate(
        routeScheduleId,
        {
            $inc: { availableSeats: -passengers.length },
            $set: {
                'seatLayout.$[elem].isBooked': true
            }
        },
        {
            arrayFilters: [{ 'elem.seatNumber': { $in: selectedSeats } }],
            new: true
        }
    );

    // 10. Send response
    res.status(201).json({
        status: 'success',
        data: {
            booking,
            message: 'Booking confirmed successfully'
        }
    });
});

exports.getMyBookings = catchAsync(async (req, res) => {
    const bookings = await Booking.find({ userId: req.user.id })
        .populate({
            path: 'routeId',
            select: 'name startLocation endLocation'
        })
        .populate({
            path: 'routeScheduleId',
            select: 'date startTime totalSeats availableSeats pricePerSeat status'
        })
        .populate({
            path: 'carId',
            select: 'model registrationNumber'
        })
        .lean();

    // Transform the data to include journey details more explicitly
    const formattedBookings = bookings.map(booking => ({
        _id: booking._id,
        userId: booking.userId,
        route: booking.routeId,
        journey: {
            date: booking.routeScheduleId?.date,
            startTime: booking.routeScheduleId?.startTime,
            totalSeats: booking.routeScheduleId?.totalSeats,
            availableSeats: booking.routeScheduleId?.availableSeats,
            pricePerSeat: booking.routeScheduleId?.pricePerSeat,
            status: booking.routeScheduleId?.status
        },
        car: booking.carId,
        passengers: booking.passengers,
        selectedSeats: booking.selectedSeats,
        totalAmount: booking.totalAmount,
        status: booking.status,
        paymentStatus: booking.paymentStatus
    }));

    res.status(200).json({
        status: 'success',
        results: formattedBookings.length,
        data: {
            bookings: formattedBookings
        }
    });
});

exports.cancelBooking = catchAsync(async (req, res) => {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
        return res.status(404).json({
            status: 'fail',
            message: 'Booking not found'
        });
    }

    // Check if the booking belongs to a route owned by this admin
    const route = await Route.findById(booking.routeId);
    if (route.adminId.toString() !== req.user.id) {
        return res.status(403).json({
            status: 'fail',
            message: 'You do not have permission to cancel this booking'
        });
    }

    booking.status = 'cancelled';
    await booking.save();

    // Release the seats
    await RouteSchedule.findByIdAndUpdate(booking.routeScheduleId, {
        $inc: { availableSeats: booking.passengers.length },
        $set: {
            'seatLayout.$[seat].isBooked': false
        }
    }, {
        arrayFilters: [{ 'seat.seatNumber': { $in: booking.selectedSeats } }]
    });

    res.status(200).json({
        status: 'success',
        data: {
            booking
        }
    });
});

// Helper function to calculate distance between two points
const calculateDistance = async (coords1, coords2) => {
    try {
        const routeData = await orsDirections.calculate({
            coordinates: [coords1, coords2],
            profile: 'driving-car',
            format: 'json'
        });
        return routeData.routes[0].summary.distance / 1000; // Convert to kilometers
    } catch (error) {
        console.error('Error calculating distance:', error);
        throw error;
    }
};

// Add a new endpoint to get available seats for a specific schedule
exports.getAvailableSeats = catchAsync(async (req, res) => {
    const { scheduleId } = req.params;

    const schedule = await RouteSchedule.findById(scheduleId)
        .select('seatLayout availableSeats pricePerSeat date');

    if (!schedule) {
        return res.status(404).json({
            status: 'fail',
            message: 'Schedule not found'
        });
    }

    res.status(200).json({
        status: 'success',
        data: {
            schedule: {
                _id: schedule._id,
                date: schedule.date,
                availableSeats: schedule.availableSeats,
                pricePerSeat: schedule.pricePerSeat,
                seatLayout: schedule.seatLayout
            }
        }
    });
});

// Add this new function to get bookings for admin
exports.getAdminBookings = catchAsync(async (req, res) => {
    // First, find routes owned by this admin
    const adminRoutes = await Route.find({ adminId: req.user.id }).select('_id');
    const adminRouteIds = adminRoutes.map(route => route._id);

    // Find bookings for these routes
    const bookings = await Booking.find({ 
        routeId: { $in: adminRouteIds } 
    })
    .populate({
        path: 'routeId',
        select: 'name startLocation endLocation adminId'
    })
    .populate({
        path: 'routeScheduleId',
        select: 'date pricePerSeat'
    })
    .populate({
        path: 'carId',
        select: 'model registrationNumber'
    });

    res.status(200).json({
        status: 'success',
        results: bookings.length,
        data: {
            bookings
        }
    });
});

// Add this function to get a single booking detail
exports.getBookingDetail = catchAsync(async (req, res) => {
    const booking = await Booking.findById(req.params.id)
        .populate({
            path: 'routeId',
            select: 'name startLocation endLocation adminId'
        })
        .populate({
            path: 'routeScheduleId',
            select: 'date pricePerSeat'
        })
        .populate({
            path: 'carId',
            select: 'model registrationNumber'
        });

    if (!booking) {
        return res.status(404).json({
            status: 'fail',
            message: 'Booking not found'
        });
    }

    // Check if the booking belongs to a route owned by this admin
    const route = await Route.findById(booking.routeId);
    if (route.adminId.toString() !== req.user.id) {
        return res.status(403).json({
            status: 'fail',
            message: 'You do not have permission to view this booking'
        });
    }

    res.status(200).json({
        status: 'success',
        data: {
            booking
        }
    });
});
