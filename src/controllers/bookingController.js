const Route = require('../models/Route');
const RouteSchedule = require('../models/RouteSchedule');
const Booking = require('../models/Booking');
const catchAsync = require('../utils/catchAsync');
const Openrouteservice = require('openrouteservice-js');
const moment = require('moment');
const Car = require('../models/Car');
const Razorpay = require('razorpay');
const { Client } = require('whatsapp-web.js');
const twilio = require('twilio');

const orsDirections = new Openrouteservice.Directions({
    api_key: process.env.OPENROUTE_API_KEY
});

const orsGeocoding = new Openrouteservice.Geocode({
    api_key: process.env.OPENROUTE_API_KEY
});

// Initialize Razorpay instance at the top level
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Replace WhatsApp initialization at the top with Twilio
const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Helper function to send WhatsApp message using Twilio
const sendWhatsAppMessage = async (to, message) => {
    try {
        // Format phone number (ensure it includes country code)
        // Remove any spaces, dashes, or other characters
        const cleanNumber = to.replace(/\D/g, '');
        // Ensure the number starts with the country code
        const formattedNumber = cleanNumber.startsWith('91') ? 
            `whatsapp:+${cleanNumber}` : 
            `whatsapp:+91${cleanNumber}`;
        
        const response = await client.messages.create({
            body: message,
            from: 'whatsapp:+14155238886', // Use the exact Twilio sandbox number
            to: formattedNumber
        });

        console.log('WhatsApp message sent successfully:', response.sid);
        return response;
    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        // Don't throw the error - we don't want to break the booking process if WhatsApp fails
    }
};

exports.searchAvailableRoutes = catchAsync(async (req, res) => {
    const { fromLocation, toLocation, date, passengers = 1 } = req.body;

    console.log('Search Criteria:', { fromLocation, toLocation, date, passengers });

    if (!fromLocation || !toLocation || !date) {
        return res.status(400).json({
            status: 'fail',
            message: 'Please provide fromLocation, toLocation and date'
        });
    }

    // Convert the search date to UTC and set time to start of the day
    const searchDate = new Date(date);
    searchDate.setUTCHours(0, 0, 0, 0);
    const nextDate = new Date(searchDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);

    // Get current date and time in UTC
    const currentDateTime = new Date();
    const currentTime = currentDateTime.toISOString().split('T')[1].substring(0, 5); // Get current time in HH:mm format

    // Find routes with available schedules
    const availableRoutes = await Route.aggregate([
        {
            $match: {
                'startLocation.address': fromLocation,
                'endLocation.address': toLocation,
                status: 'active'
            }
        },
        // Log the matched routes
        { $addFields: { matchedRoutes: true } },
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
        // Log the routes with schedules
        { $addFields: { routesWithSchedules: true } },
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

    console.log('Available Routes:', availableRoutes);

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
    console.log('=== Create Booking Started ===');
    console.log('Request Body:', {
        routeId: req.body.routeId,
        routeScheduleId: req.body.routeScheduleId,
        carId: req.body.carId,
        passengers: req.body.passengers,
        selectedSeats: req.body.selectedSeats
    });

    const {
        routeId,
        routeScheduleId,
        carId,
        passengers,
        selectedSeats
    } = req.body;

    // 1. Validate input
    if (!routeId || !routeScheduleId || !carId || !passengers || !selectedSeats) {
        console.log('Validation Failed: Missing required fields');
        return res.status(400).json({
            status: 'fail',
            message: 'Please provide all required booking details'
        });
    }

    // 2. Check if number of passengers matches selected seats
    console.log('Validating passengers count:', {
        passengersLength: passengers.length,
        selectedSeatsLength: selectedSeats.length
    });

    if (passengers.length !== selectedSeats.length) {
        console.log('Validation Failed: Passenger count mismatch');
        return res.status(400).json({
            status: 'fail',
            message: 'Number of passengers must match number of selected seats'
        });
    }

    // 3. Get route schedule and check availability
    console.log('Fetching schedule:', routeScheduleId);
    const schedule = await RouteSchedule.findById(routeScheduleId);
    console.log('Found schedule:', schedule);
    
    if (!schedule) {
        console.log('Error: Schedule not found');
        return res.status(404).json({
            status: 'fail',
            message: 'Schedule not found'
        });
    }

    // 4. Check if schedule is active
    console.log('Checking schedule status:', schedule.status);
    if (schedule.status !== 'active') {
        console.log('Error: Schedule not active');
        return res.status(400).json({
            status: 'fail',
            message: 'This schedule is not active for booking'
        });
    }

    // 5. Check if enough seats are available
    console.log('Checking seat availability:', {
        availableSeats: schedule.availableSeats,
        requestedSeats: passengers.length
    });
    
    if (schedule.availableSeats < passengers.length) {
        console.log('Error: Insufficient seats');
        return res.status(400).json({
            status: 'fail',
            message: 'Not enough seats available'
        });
    }

    // 6. Verify selected seats are available
    console.log('Verifying selected seats:', selectedSeats);
    const unavailableSeats = schedule.seatLayout.filter(
        seat => selectedSeats.includes(seat.seatNumber) && seat.isBooked
    );
    console.log('Unavailable seats:', unavailableSeats);

    if (unavailableSeats.length > 0) {
        console.log('Error: Some seats already booked');
        return res.status(400).json({
            status: 'fail',
            message: `Seats ${unavailableSeats.map(s => s.seatNumber).join(', ')} are already booked`
        });
    }

    // 7. Calculate total amount
    const totalAmount = passengers.length * schedule.pricePerSeat;
    const advanceAmount = totalAmount * 0.4; // 40% of total amount
    const remainingAmount = totalAmount * 0.6; // 60% of total amount

    try {
        // Get route details before creating booking
        const route = await Route.findById(routeId);
        if (!route) {
            return res.status(404).json({
                status: 'fail',
                message: 'Route not found'
            });
        }

        // Create booking with initialized paymentDetails
        console.log('Creating booking...');
        const booking = await Booking.create({
            userId: req.user.id,
            routeId,
            routeScheduleId,
            carId,
            passengers,
            selectedSeats,
            totalAmount,
            status: 'pending',
            paymentStatus: 'pending',
            paymentDetails: {
                advanceAmount,
                remainingAmount,
                totalAmount,
                paymentDate: new Date()
            }
        });
        console.log('Booking created:', booking._id);

        // Create Razorpay order
        console.log('Creating Razorpay order...');
        const order = await razorpay.orders.create({
            amount: advanceAmount * 100, // Convert to paise
            currency: 'INR',
            receipt: `receipt_${booking._id}`,
        });
        console.log('Razorpay order created:', order.id);

        // Update seat availability in schedule
        console.log('Updating seat availability...');
        const updatedSchedule = await RouteSchedule.findByIdAndUpdate(
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
        console.log('Schedule updated:', {
            newAvailableSeats: updatedSchedule.availableSeats,
            updatedSeats: selectedSeats
        });

        // After successful booking creation, send WhatsApp message
        const bookingDetails = `
🎫 Booking Confirmation
Booking ID: ${booking._id}
Route: ${route.name}
From: ${route.startLocation.address}
To: ${route.endLocation.address}
Date: ${moment(schedule.date).format('DD MMM YYYY')}
Time: ${schedule.startTime}
Seats: ${selectedSeats.join(', ')}
Total Amount: ₹${totalAmount}
Advance Payment: ₹${advanceAmount}
Remaining Amount: ₹${remainingAmount}

Payment Status: Pending
Please complete your advance payment to confirm the booking.
        `;

        // Send message to each passenger
        for (const passenger of passengers) {
            if (passenger.phone) { // Changed from contactNumber to phone
                await sendWhatsAppMessage(passenger.phone, bookingDetails);
            }
        }

        // Send response
        console.log('=== Create Booking Completed Successfully ===');
        res.status(201).json({
            status: 'success',
            data: {
                booking,
                orderId: order.id,
                message: 'Booking created successfully, awaiting payment'
            }
        });

    } catch (error) {
        console.error('Error in booking creation:', error);
        throw error;
    }
});

exports.confirmPayment = catchAsync(async (req, res) => {
    const { bookingId, paymentId } = req.body;

    console.log('Payment Details:', { bookingId, paymentId });

    if (!bookingId || !paymentId) {
        console.log('Validation Failed: Missing required fields');
        return res.status(400).json({
            status: 'fail',
            message: 'Please provide bookingId and paymentId'
        });
    }

    try {
        // Fetch the booking to get total amount
        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return res.status(404).json({
                status: 'fail',
                message: 'Booking not found'
            });
        }
        const payment = await razorpay.payments.fetch(paymentId);
        const successfulPaymentStatuses = ['captured', 'authorized'];
        
        if (!successfulPaymentStatuses.includes(payment.status)) {
            return res.status(400).json({
                status: 'fail',
                message: 'Payment not successful'
            });
        }

        // Calculate payment details
        const advanceAmount = payment.amount / 100;
        const remainingAmount = booking.totalAmount - advanceAmount;
        const updatedBooking = await Booking.findByIdAndUpdate(
            bookingId,
            {
                status: 'confirmed',
                paymentStatus: 'partially_paid',
                razorpayPaymentId: paymentId,
                paymentDetails: {
                    ...payment,
                    advanceAmount,
                    remainingAmount,
                    totalAmount: booking.totalAmount,
                    paymentDate: new Date()
                }
            },
            { new: true }
        );

        // After successful payment confirmation, send WhatsApp message
        const paymentConfirmation = `
💳 Payment Confirmation
Booking ID: ${booking._id}
Payment ID: ${paymentId}
Amount Paid: ₹${advanceAmount}
Remaining Amount: ₹${remainingAmount}

Your booking is now confirmed! 
Please pay the remaining amount before the journey.

Journey Details:
Date: ${moment(booking.routeScheduleId.date).format('DD MMM YYYY')}
Time: ${booking.routeScheduleId.startTime}
Seats: ${booking.selectedSeats.join(', ')}
        `;

        // Send message to each passenger
        for (const passenger of booking.passengers) {
            if (passenger.contactNumber) {
                await sendWhatsAppMessage(passenger.contactNumber, paymentConfirmation);
            }
        }

        res.status(200).json({
            status: 'success',
            data: {
                booking: updatedBooking,
                paymentSummary: {
                    advanceAmount,
                    remainingAmount,
                    totalAmount: booking.totalAmount
                },
                message: 'Advance payment confirmed and booking updated'
            }
        });
    } catch (error) {
        console.error('Error in payment confirmation:', error);
        throw error;
    }
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

    // Transform the data to include all details
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
        paymentDetails: {
            advanceAmount: booking.paymentDetails?.advanceAmount || 0,
            remainingAmount: booking.paymentDetails?.remainingAmount || 0,
            totalAmount: booking.paymentDetails?.totalAmount || booking.totalAmount,
            paymentDate: booking.paymentDetails?.paymentDate,
            razorpayPaymentId: booking.razorpayPaymentId
        },
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
        select: 'date startTime pricePerSeat'
    })
    .populate({
        path: 'carId',
        select: 'model registrationNumber'
    })
    .select('+paymentDetails +paymentStatus +totalAmount +razorpayPaymentId')
    .lean();

    // Add payment details to the response
    const bookingsWithPayments = bookings.map(booking => ({
        ...booking,
        paymentDetails: {
            advanceAmount: booking.paymentDetails?.advanceAmount || 0,
            remainingAmount: booking.paymentDetails?.remainingAmount || 0,
            totalAmount: booking.paymentDetails?.totalAmount || booking.totalAmount,
            paymentDate: booking.paymentDetails?.paymentDate
        },
        paymentStatus: booking.paymentStatus,
        razorpayPaymentId: booking.razorpayPaymentId
    }));

    res.status(200).json({
        status: 'success',
        results: bookings.length,
        data: {
            bookings: bookingsWithPayments
        }
    });
});

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

exports.getDriverRouteSchedules = async (req, res) => {
  try {
    const driverId = req.user._id; // Assuming the driver's ID is stored in req.user

    // Find the car associated with the driver
    const car = await Car.findOne({ driverId: driverId });

    if (!car) {
      console.log('No car found for driver:', driverId);
      return res.status(404).json({
        status: 'fail',
        message: 'No car found for this driver'
      });
    }

    console.log('Car found for driver:', car);

    // Set the date range to include yesterday, today, and tomorrow
    const today = new Date();
    const startOfYesterday = new Date(today);
    startOfYesterday.setDate(today.getDate() - 1);
    startOfYesterday.setUTCHours(0, 0, 0, 0);

    const endOfTomorrow = new Date(today);
    endOfTomorrow.setDate(today.getDate() + 1);
    endOfTomorrow.setUTCHours(23, 59, 59, 999);

    console.log('Date range:', startOfYesterday.toISOString(), endOfTomorrow.toISOString());

    // Find route schedules for the driver's car within the specified date range
    const routeSchedules = await RouteSchedule.find({
      carId: car._id, // Ensure this field exists in RouteSchedule
      date: {
        $gte: startOfYesterday,
        $lte: endOfTomorrow
      },
      status: 'active'
    });

    console.log('Route Schedules:', routeSchedules);

    res.status(200).json({
      status: 'success',
      data: {
        routeSchedules
      }
    });
  } catch (error) {
    console.error('Error fetching driver route schedules:', error);
    res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching driver route schedules.'
    });
  }
};

exports.getDriverBookingsWithTravelDate = async (req, res) => {
  try {
    console.log('Fetching all bookings...');

    // Fetch all bookings
    const bookings = await Booking.find()
      .populate({
        path: 'routeScheduleId',
        select: 'date startTime totalSeats availableSeats pricePerSeat status',
        match: { status: 'active' } // Ensure only active schedules are populated
      })
      .populate('userId', 'name email phone')
      .populate('routeId', 'name')
      .populate('carId', 'model registrationNumber');

    console.log('Bookings fetched:', bookings);

    // Format the response to include travel date
    const formattedBookings = bookings.map(booking => {
      console.log('Processing booking:', booking);

      const formattedBooking = {
        _id: booking._id,
        userId: booking.userId,
        route: booking.routeId,
        car: booking.carId,
        passengers: booking.passengers,
        selectedSeats: booking.selectedSeats,
        totalAmount: booking.totalAmount,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        travelDate: booking.routeScheduleId ? booking.routeScheduleId.date : null,
        startTime: booking.routeScheduleId ? booking.routeScheduleId.startTime : null
      };

      console.log('Formatted booking:', formattedBooking);
      return formattedBooking;
    });

    console.log('All formatted bookings:', formattedBookings);

    res.status(200).json({
      status: 'success',
      data: {
        bookings: formattedBookings
      }
    });
  } catch (error) {
    console.error('Error fetching bookings with travel date:', error);
    res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching bookings with travel date.'
    });
  }
};
