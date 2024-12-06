const RouteSchedule = require('../models/RouteSchedule');
const catchAsync = require('../utils/catchAsync');

exports.createRouteSchedule = catchAsync(async (req, res) => {
    const {
        routeId,
        dates,
        totalSeats,
        pricePerSeat
    } = req.body;

    // Validate input
    if (!routeId || !dates || !Array.isArray(dates) || !totalSeats || !pricePerSeat) {
        return res.status(400).json({
            status: 'fail',
            message: 'Please provide routeId, dates array (with date and startTime), totalSeats, and pricePerSeat'
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
        // Set time to start of day for date-only comparison
        checkDate.setHours(0, 0, 0, 0);

        const existingSchedule = await RouteSchedule.findOne({
            date: {
                $gte: checkDate,
                $lt: new Date(checkDate.getTime() + 24 * 60 * 60 * 1000)
            }
        });

        if (existingSchedule) {
            return res.status(400).json({
                status: 'fail',
                message: `A schedule already exists for date ${dateObj.date}`
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

    console.log('Querying route schedules with:', query); // Debugging line

    const routeSchedules = await RouteSchedule.find(query)
        .populate({
            path: 'routeId',
            select: 'name startLocation endLocation'
        })
        .sort({ date: 1 });

    if (!routeSchedules.length) {
        console.log('No schedules found for query:', query);
        return res.status(404).json({
            status: 'fail',
            message: 'No schedules found for this route'
        });
    }

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
    const scheduleId = req.params.routeId;
    const { date } = req.query;

    if (!scheduleId || !date) {
        return res.status(400).json({
            status: 'fail',
            message: 'Please provide both schedule ID and date to delete the schedule'
        });
    }

    // Convert date string to Date object
    const queryDate = new Date(date);
    queryDate.setUTCHours(0, 0, 0, 0);  // Set to start of day in UTC

    console.log('Attempting to delete schedule with:', {
        _id: scheduleId,
        date: queryDate
    });

    // Find the specific schedule by _id
    const schedule = await RouteSchedule.findOne({
        _id: scheduleId,
        date: queryDate
    }).exec();

    console.log('Found schedule:', schedule); // Debug log

    if (!schedule) {
        return res.status(404).json({
            status: 'fail',
            message: 'No schedule found for this ID on the specified date'
        });
    }

    // Check if there are any booked seats
    const hasBookedSeats = schedule.seatLayout.some(seat => seat.isBooked);
    if (hasBookedSeats) {
        return res.status(400).json({
            status: 'fail',
            message: 'Cannot delete schedule with booked seats'
        });
    }

    // Delete the schedule
    await RouteSchedule.findByIdAndDelete(schedule._id);

    res.status(204).json({
        status: 'success',
        data: null
    });
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