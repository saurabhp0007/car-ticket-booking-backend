const RouteSchedule = require('../models/RouteSchedule');
const catchAsync = require('../utils/catchAsync');
const Booking = require('../models/Booking');

exports.createRouteSchedule = catchAsync(async (req, res) => {

    const {
        routeId,
        dates,
        totalSeats,
        pricePerSeat,
        carId
    } = req.body;

    // Validate input
    if (!routeId || !dates || !Array.isArray(dates) || !totalSeats || !pricePerSeat || !carId) {
        return res.status(400).json({
            status: 'fail',
            message: 'Please provide routeId, carId, dates array (with date and startTime), totalSeats, and pricePerSeat'
        });
    }

    // Validate each date object has required properties
    const isValidDates = dates.every(item => item.date && item.startTime);
    if (!isValidDates) {
        return res.status(400).json({
            status: 'fail',
            message: 'Each date in the dates array must have date and startTime properties'
        });
    }

    // Check for existing schedules on the same date
    for (const dateObj of dates) {
        const checkDate = new Date(dateObj.date);
        checkDate.setHours(0, 0, 0, 0);

        const query = {
            date: {
                $gte: checkDate,
                $lt: new Date(checkDate.getTime() + 24 * 60 * 60 * 1000)
            },
            carId: carId,
            startTime: dateObj.startTime
        };


        const existingSchedule = await RouteSchedule.findOne(query);
        
        if (existingSchedule) {
            
            return res.status(400).json({
                status: 'fail',
                message: `A schedule already exists for date ${dateObj.date} at ${dateObj.startTime} with car ID ${carId}`
            });
        }
    }

    // Create seat layout template
    const seatLayout = Array.from({ length: totalSeats }, (_, index) => ({
        seatNumber: `A${index + 1}`,
        isBooked: false
    }));

    // Create schedules for all dates
    const schedules = await Promise.all(
        dates.map(async (dateObj) => {
            return RouteSchedule.create({
                routeId,
                carId,
                date: new Date(dateObj.date),
                startTime: dateObj.startTime,
                totalSeats,
                availableSeats: totalSeats,
                pricePerSeat,
                seatLayout,
                status: 'active'
            });
        })
    );

    res.status(201).json({
        status: 'success',
        results: schedules.length,
        data: {
            schedules
        }
    });
});

exports.getRouteSchedules = catchAsync(async (req, res) => {
    // Get routeId from either params or query
    const routeId = req.params.routeId || req.query.routeId;
    const { date } = req.query;

    if (!routeId) {
        return res.status(400).json({
            status: 'fail',
            message: 'Route ID is required'
        });
    }

    const query = { routeId };
    if (date) query.date = new Date(date);


    const routeSchedules = await RouteSchedule.find(query)
        .populate({
            path: 'routeId',
            select: 'name startLocation endLocation'
        })
        .sort({ date: 1 });

    res.status(200).json({
        status: 'success',
        results: routeSchedules.length,
        data: {
            routeSchedules
        }
    });
});

exports.updateRouteSchedule = catchAsync(async (req, res) => {
    const { id } = req.params;
    const allowedUpdates = ['pricePerSeat', 'status', 'startTime', 'totalSeats'];
    const updates = {};

    // Only allow specified fields to be updated
    Object.keys(req.body).forEach(key => {
        if (allowedUpdates.includes(key)) {
            updates[key] = req.body[key];
        }
    });

    // If updating totalSeats, update seatLayout and availableSeats
    if (updates.totalSeats) {
        const routeSchedule = await RouteSchedule.findById(id);
        if (!routeSchedule) {
            return res.status(404).json({
                status: 'fail',
                message: 'Route schedule not found'
            });
        }

        // Check if new total seats is less than booked seats
        const bookedSeats = routeSchedule.seatLayout.filter(seat => seat.isBooked).length;
        if (updates.totalSeats < bookedSeats) {
            return res.status(400).json({
                status: 'fail',
                message: 'Cannot reduce total seats below number of booked seats'
            });
        }

        // Update seat layout
        updates.seatLayout = Array.from({ length: updates.totalSeats }, (_, index) => ({
            seatNumber: `A${index + 1}`,
            isBooked: index < routeSchedule.seatLayout.length ? 
                      routeSchedule.seatLayout[index].isBooked : false
        }));

        // Update available seats
        updates.availableSeats = updates.totalSeats - bookedSeats;
    }

    const routeSchedule = await RouteSchedule.findByIdAndUpdate(
        id,
        updates,
        { new: true, runValidators: true }
    );

    if (!routeSchedule) {
        return res.status(404).json({
            status: 'fail',
            message: 'Route schedule not found'
        });
    }

    res.status(200).json({
        status: 'success',
        data: {
            routeSchedule
        }
    });
});

exports.deleteRouteSchedule = catchAsync(async (req, res) => {
    try {

        const scheduleId = req.params.routeId || req.params.scheduleId;
        const { date } = req.query;

        if (!scheduleId || !date) {
            return res.status(400).json({
                status: 'fail',
                message: 'Please provide both schedule ID and date to delete the schedule'
            });
        }

        // Find the schedule
        const schedule = await RouteSchedule.findById(scheduleId);
        if (!schedule) {
            return res.status(404).json({
                status: 'fail',
                message: 'No schedule found for this ID'
            });
        }

        // Check if the schedule date is today or in the future
        const scheduleDate = new Date(schedule.date);
        scheduleDate.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // If schedule is for today or future date, check for bookings
        if (scheduleDate >= today) {
            const hasBookedSeats = schedule.seatLayout.some(seat => seat.isBooked);
            if (hasBookedSeats) {
                return res.status(400).json({
                    status: 'fail',
                    message: 'Cannot delete schedule with booked seats for today or future dates'
                });
            }
        }

        // If schedule is in the past, we can delete it regardless of bookings
        if (scheduleDate < today) {
            // Cache the schedule data in all related bookings
            await Booking.updateMany(
                { routeScheduleId: scheduleId },
                { 
                    $set: { 
                        scheduleDeleted: true,
                        scheduleDeletedAt: new Date(),
                        cachedScheduleData: {
                            date: schedule.date,
                            startTime: schedule.startTime,
                            totalSeats: schedule.totalSeats,
                            availableSeats: schedule.availableSeats,
                            pricePerSeat: schedule.pricePerSeat
                        }
                    }
                }
            );
        }

        // Delete the schedule
        await RouteSchedule.findByIdAndDelete(scheduleId);

        return res.status(200).json({
            status: 'success',
            message: 'Schedule deleted successfully'
        });

    } catch (error) {
        console.error('\n=== Error in deleteRouteSchedule ===');
        console.error('Error details:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            error: error.message
        });
    }
});

exports.getAvailableSeats = catchAsync(async (req, res) => {
    const { routeScheduleId } = req.params;

    const routeSchedule = await RouteSchedule.findById(routeScheduleId)
        .select('seatLayout availableSeats pricePerSeat');

    if (!routeSchedule) {
        return res.status(404).json({
            status: 'fail',
            message: 'Route schedule not found'
        });
    }

    res.status(200).json({
        status: 'success',
        data: {
            availableSeats: routeSchedule.availableSeats,
            pricePerSeat: routeSchedule.pricePerSeat,
            seatLayout: routeSchedule.seatLayout
        }
    });
});

exports.getRouteScheduleById = catchAsync(async (req, res) => {
    const { routeScheduleId } = req.params;

    const routeSchedule = await RouteSchedule.findById(routeScheduleId);

    if (!routeSchedule) {
        return res.status(404).json({
            status: 'fail',
            message: 'Route schedule not found'
        });
    }

    res.status(200).json({
        status: 'success',
        data: {
            routeSchedule
        }
    });
});

exports.getAllRouteSchedules = catchAsync(async (req, res) => {
    const { date } = req.query;

    // Get today's date at start of day
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build query object
    const query = { 
        status: 'active',
        date: { $gte: today }
    };
    if (date) {
        const queryDate = new Date(date);
        queryDate.setHours(0, 0, 0, 0);
        const nextDay = new Date(queryDate);
        nextDay.setDate(nextDay.getDate() + 1);
        
        query.date = {
            $gte: queryDate,
            $lt: nextDay
        };
    }

    const routeSchedules = await RouteSchedule.find(query)
        .populate({
            path: 'routeId',
            select: 'name startLocation endLocation'
        })
        .sort({ date: 1, startTime: 1 });
    
    if (routeSchedules.length === 0) {
        const totalDocs = await RouteSchedule.countDocuments({});
        
        return res.status(404).json({
            status: 'fail',
            message: 'No schedules found'
        });
    }

    const response = {
        status: 'success',
        results: routeSchedules.length,
        data: {
            routeSchedules
        }
    };

    res.status(200).json(response);
}); 