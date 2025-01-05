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

    // Get current date and time in UTC
    const currentDateTime = new Date();
    const currentTime = currentDateTime.toISOString().split('T')[1].substring(0, 5); // Get current time in HH:mm format
    
    // Convert the search date to UTC
    const searchDate = new Date(date);
    searchDate.setUTCHours(0, 0, 0, 0);
    const nextDate = new Date(searchDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);

    console.log('Current Time:', currentTime);
    console.log('Current DateTime:', currentDateTime);

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
                                    { $eq: ['$status', 'active'] },
                                    {
                                        $cond: {
                                            if: {
                                                $eq: [
                                                    { $dateToString: { date: '$date', format: '%Y-%m-%d' } },
                                                    { $dateToString: { date: currentDateTime, format: '%Y-%m-%d' } }
                                                ]
                                            },
                                            then: { $gt: [{ $toString: '$startTime' }, currentTime] },
                                            else: true
                                        }
                                    }
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
                    totalSeats: 1,
                    seatLayout: 1
                },
                totalPrice: {
                    $multiply: ['$schedule.pricePerSeat', passengers]
                }
            }
        }
    ]);

    // Additional filter for routes that have passed
    const filteredRoutes = availableRoutes.filter(route => {
        const scheduleDate = new Date(route.schedule.date);
        const scheduleTime = route.schedule.startTime;
        
        // If it's a future date, include it
        if (scheduleDate > currentDateTime) return true;
        
        // If it's today, check the time
        if (scheduleDate.toDateString() === currentDateTime.toDateString()) {
            return scheduleTime > currentTime;
        }
        
        return false;
    });

    console.log('Found routes:', filteredRoutes);

    res.status(200).json({
        status: 'success',
        results: filteredRoutes.length,
        data: {
            routes: filteredRoutes
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
            select: 'date startTime totalSeats availableSeats pricePerSeat status',
            options: { retainNullValues: true }
        })
        .populate({
            path: 'carId',
            select: 'model registrationNumber'
        })
        .populate({
            path: 'passengers',
            select: 'name age gender contactNumber'
        })
        .lean();

    // Transform the data to include journey details more explicitly
    const formattedBookings = bookings.map(booking => ({
        _id: booking._id,
        userId: booking.userId,
        route: booking.routeId,
        journey: {
            date: booking.routeScheduleId?.date || booking.cachedScheduleData?.date,
            startTime: booking.routeScheduleId?.startTime || booking.cachedScheduleData?.startTime,
            totalSeats: booking.routeScheduleId?.totalSeats || booking.cachedScheduleData?.totalSeats,
            availableSeats: booking.routeScheduleId?.availableSeats || booking.cachedScheduleData?.availableSeats,
            pricePerSeat: booking.routeScheduleId?.pricePerSeat || booking.cachedScheduleData?.pricePerSeat,
            status: booking.scheduleDeleted ? 'deleted' : (booking.routeScheduleId?.status || 'unknown')
        },
        car: booking.carId,
        passengers: booking.passengers,
        selectedSeats: booking.selectedSeats,
        totalAmount: booking.totalAmount,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        scheduleStatus: {
            isDeleted: booking.scheduleDeleted,
            deletedAt: booking.scheduleDeletedAt
        }
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
