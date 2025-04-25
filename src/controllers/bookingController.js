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
const mongoose = require('mongoose');

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

        return response;
    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        // Don't throw the error - we don't want to break the booking process if WhatsApp fails
    }
};

// Helper function to calculate distance and proportional price between points
const calculateDistanceAndPrice = async (points, totalRoutePoints, originalPrice) => {
    try {
        // Skip calculation if points are missing
        if (!points || points.length < 2 || !totalRoutePoints || totalRoutePoints.length < 2) {
            return {
                fullDistance: 0,
                segmentDistance: 0,
                price: originalPrice,
                priceRatio: 1
            };
        }

        // Ensure coordinates are in the correct format [longitude, latitude]
        const fullRouteCoordinates = await Promise.all(totalRoutePoints.map(async point => {
            try {
                // Check if point already has valid coordinates
                if (point.coordinates && 
                    Array.isArray(point.coordinates) && 
                    point.coordinates.length >= 2) {
                    return point.coordinates;
                }
                
                // Otherwise geocode to get fresh coordinates
                const geocodeRequest = {
                    text: point.address,
                    boundary_country: ['IND']
                };
                const geocodeResponse = await orsGeocoding.geocode(geocodeRequest);
                return geocodeResponse.features[0].geometry.coordinates;
            } catch (error) {
                console.error(`Geocoding error for ${point.address}:`, error);
                // Return a default coordinate in India if geocoding fails
                return [78.96, 20.59]; // Center of India
            }
        }));

        const segmentCoordinates = await Promise.all(points.map(async point => {
            try {
                // Check if point already has valid coordinates
                if (point.coordinates && 
                    Array.isArray(point.coordinates) && 
                    point.coordinates.length >= 2) {
                    return point.coordinates;
                }
                
                // Otherwise geocode to get fresh coordinates
                const geocodeRequest = {
                    text: point.address,
                    boundary_country: ['IND']
                };
                const geocodeResponse = await orsGeocoding.geocode(geocodeRequest);
                return geocodeResponse.features[0].geometry.coordinates;
            } catch (error) {
                console.error(`Geocoding error for ${point.address}:`, error);
                // Return a default coordinate in India if geocoding fails
                return [78.96, 20.59]; // Center of India
            }
        }));
        
        try {
            // Get full route distance
            const fullRouteRequest = {
                coordinates: fullRouteCoordinates,
                profile: 'driving-car',
                format: 'json'
            };
            const fullRouteResponse = await orsDirections.calculate(fullRouteRequest);
            const fullDistance = fullRouteResponse.routes[0].summary.distance / 1000;

            // Get segment distance
            const segmentRequest = {
                coordinates: segmentCoordinates,
                profile: 'driving-car',
                format: 'json'
            };
            const segmentResponse = await orsDirections.calculate(segmentRequest);
            const segmentDistance = segmentResponse.routes[0].summary.distance / 1000;

            // Calculate proportional price
            const priceRatio = segmentDistance / fullDistance;
            const segmentPrice = Math.ceil(originalPrice * priceRatio);


            return {
                fullDistance,
                segmentDistance,
                price: segmentPrice,
                priceRatio
            };
        } catch (directionError) {
            console.error('Error calculating directions:', directionError);
            // Fallback to haversine calculation
            return fallbackDistanceCalculation(fullRouteCoordinates, segmentCoordinates, originalPrice);
        }
    } catch (error) {
        console.error('Error calculating distance:', error);
        console.error('Error details:', {
            message: error.message,
            points: points,
            totalRoutePoints: totalRoutePoints
        });

        // Fallback calculation with coordinate validation
        try {
            return fallbackDistanceCalculation(
                totalRoutePoints.map(p => p.coordinates || [78.96, 20.59]),
                points.map(p => p.coordinates || [78.96, 20.59]),
                originalPrice
            );
        } catch (fallbackError) {
            console.error('Fallback calculation failed:', fallbackError);
            // Return original price if all calculations fail
            return {
                fullDistance: 0,
                segmentDistance: 0,
                price: originalPrice,
                priceRatio: 1
            };
        }
    }
};

// Helper function for fallback distance calculation
const fallbackDistanceCalculation = (fullRouteCoordinates, segmentCoordinates, originalPrice) => {
    // Haversine formula with accurate Earth radius
    const getDistance = (coord1, coord2) => {
        const R = 6371; // Earth radius in km
        const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
        const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(coord1[1] * Math.PI / 180) * 
            Math.cos(coord2[1] * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    };

    // Ensure we have at least 2 coordinates for each set
    if (fullRouteCoordinates.length < 2 || segmentCoordinates.length < 2) {
        return {
            fullDistance: 0,
            segmentDistance: 0,
            price: originalPrice,
            priceRatio: 1
        };
    }

    // Calculate distances
    let fullDistance = 0;
    for (let i = 0; i < fullRouteCoordinates.length - 1; i++) {
        fullDistance += getDistance(fullRouteCoordinates[i], fullRouteCoordinates[i+1]);
    }

    let segmentDistance = 0;
    for (let i = 0; i < segmentCoordinates.length - 1; i++) {
        segmentDistance += getDistance(segmentCoordinates[i], segmentCoordinates[i+1]);
    }

    // Ensure we don't divide by zero
    if (fullDistance === 0) {
        fullDistance = 1;  // Set a minimum to avoid division by zero
    }

    const priceRatio = segmentDistance / fullDistance;
    const segmentPrice = Math.ceil(originalPrice * priceRatio);


    return {
        fullDistance,
        segmentDistance,
        price: segmentPrice,
        priceRatio
    };
};

// Add this error handling helper function at the top after imports
const handleRazorpayError = (error) => {
    console.error('Razorpay Error:', error);
    
    // Common Razorpay error codes and meanings
    const errorMessages = {
        'BAD_REQUEST_ERROR': 'The payment request was invalid',
        'GATEWAY_ERROR': 'There was an issue with the payment gateway',
        'SERVER_ERROR': 'Razorpay server is experiencing issues',
        'TRANSACTION_ERROR': 'The transaction failed to process'
    };
    
    const errorCode = error.code || error.error?.code;
    const errorDescription = error.description || error.error?.description;
    
    return {
        status: 'error',
        code: errorCode,
        message: errorMessages[errorCode] || errorDescription || 'Payment processing failed',
        details: error.error || error
    };
};

/**
 * Cleanup function for abandoned bookings
 * This releases seats that were reserved but payment was never completed
 */
const cleanupAbandonedBooking = async (bookingId) => {
    try {
        const booking = await Booking.findById(bookingId);
        
        // Only cleanup bookings that are still pending
        if (!booking || booking.status !== 'pending') {
            return;
        }
        
        
        // Update booking status to abandoned
        await Booking.findByIdAndUpdate(
            bookingId,
            {
                status: 'abandoned',
                paymentStatus: 'failed'
            }
        );
        
        // Release the seats back to the schedule
        await RouteSchedule.findByIdAndUpdate(
            booking.routeScheduleId,
            {
                $inc: { availableSeats: booking.selectedSeats.length },
                $set: {
                    'seatLayout.$[elem].isBooked': false
                }
            },
            {
                arrayFilters: [{ 'elem.seatNumber': { $in: booking.selectedSeats } }]
            }
        );
        
    } catch (error) {
        console.error('Error cleaning up abandoned booking:', error);
    }
};

exports.searchAvailableRoutes = catchAsync(async (req, res) => {
    const { fromLocation, toLocation, date, passengers = 1 } = req.body;


    if (!fromLocation || !toLocation || !date) {
        return res.status(400).json({
            status: 'fail',
            message: 'Please provide fromLocation, toLocation and date'
        });
    }

    // Extract city names from full addresses for more flexible matching
    const extractCityName = (fullAddress) => {
        if (!fullAddress) return '';
        // Typically addresses are in format "City, State, Country"
        // Extract just the city part
        return fullAddress.split(',')[0].trim();
    };

    const fromCity = extractCityName(fromLocation);
    const toCity = extractCityName(toLocation);


    // Convert the search date to UTC and set time to start of the day
    const searchDate = new Date(date);
    searchDate.setUTCHours(0, 0, 0, 0);
    const nextDate = new Date(searchDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);

    // Get current date and time in UTC
    const currentDateTime = new Date();
    const currentTime = currentDateTime.toISOString().split('T')[1].substring(0, 5);

    // Find routes with available schedules, including waypoint matches
    // Use regex for more flexible city name matching
    const availableRoutes = await Route.aggregate([
        {
            $match: {
                $and: [
                    {
                        $or: [
                            // Direct route matches with flexible city matching
                            {
                                $and: [
                                    { 'startLocation.address': { $regex: fromCity, $options: 'i' } },
                                    { 'endLocation.address': { $regex: toCity, $options: 'i' } }
                                ]
                            },
                            // Waypoint matches for start location
                            {
                                $and: [
                                    { 'waypoints.address': { $regex: fromCity, $options: 'i' } },
                                    { 'endLocation.address': { $regex: toCity, $options: 'i' } }
                                ]
                            },
                            // Waypoint matches for end location
                            {
                                $and: [
                                    { 'startLocation.address': { $regex: fromCity, $options: 'i' } },
                                    { 'waypoints.address': { $regex: toCity, $options: 'i' } }
                                ]
                            },
                            // Both locations in waypoints
                            {
                                $and: [
                                    { 'waypoints.address': { $regex: fromCity, $options: 'i' } },
                                    { 'waypoints.address': { $regex: toCity, $options: 'i' } }
                                ]
                            }
                        ]
                    },
                    { status: 'active' }
                ]
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
            $addFields: {
                isDirectRoute: {
                    $and: [
                        { $regexMatch: { input: '$startLocation.address', regex: fromCity, options: 'i' } },
                        { $regexMatch: { input: '$endLocation.address', regex: toCity, options: 'i' } }
                    ]
                },
                routeType: {
                    $cond: {
                        if: {
                            $and: [
                                { $regexMatch: { input: '$startLocation.address', regex: fromCity, options: 'i' } },
                                { $regexMatch: { input: '$endLocation.address', regex: toCity, options: 'i' } }
                            ]
                        },
                        then: 'direct',
                        else: 'via-waypoint'
                    }
                }
            }
        },
        {
            $project: {
                name: 1,
                startLocation: 1,
                endLocation: 1,
                waypoints: 1,
                routeType: 1,
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
                },
                // Add relevant waypoints for the journey
                relevantWaypoints: {
                    $filter: {
                        input: '$waypoints',
                        as: 'waypoint',
                        cond: {
                            $or: [
                                { $regexMatch: { input: '$$waypoint.address', regex: fromCity, options: 'i' } },
                                { $regexMatch: { input: '$$waypoint.address', regex: toCity, options: 'i' } }
                            ]
                        }
                    }
                }
            }
        },
        {
            $sort: { 
                isDirectRoute: -1,  // Direct routes first
                totalPrice: 1       // Then by price
            }
        }
    ]);


    // Additional filter for routes that have passed
    const filteredRoutes = availableRoutes.filter(route => {
        const scheduleDate = new Date(route.schedule.date);
        
        // Check if schedule has a date in the future
        if (scheduleDate > currentDateTime) return true;
        
        // If it's today, check the time if available
        if (scheduleDate.toDateString() === currentDateTime.toDateString()) {
            // If startTime is not available, include the route
            if (!route.schedule.startTime) return true;
            
            // Otherwise, compare with current time
            return route.schedule.startTime > currentTime;
        }
        
        return false;
    });


    // Calculate actual prices based on route segments
    const routesWithAdjustedPrices = await Promise.all(filteredRoutes.map(async route => {
        try {
            let points = [];
            let segmentDescription = [];
            const originalPrice = route.schedule.pricePerSeat;

            if (route.routeType === 'direct') {
                points = [route.startLocation, route.endLocation];
                try {
                    const routeCalculation = await calculateDistanceAndPrice(
                        points,
                        points,
                        originalPrice
                    );

                    return {
                        ...route,
                        distanceDetails: {
                            segmentType: 'direct',
                            fullDistance: routeCalculation?.fullDistance,
                            segmentDistance: routeCalculation?.segmentDistance,
                            originalPrice,
                            adjustedPrice: originalPrice
                        }
                    };
                } catch (error) {
                    console.error('Error calculating distance for direct route:', error);
                    // Return the route with original price if distance calculation fails
                    return {
                        ...route,
                        distanceDetails: {
                            segmentType: 'direct',
                            error: 'Failed to calculate distance',
                            originalPrice,
                            adjustedPrice: originalPrice
                        }
                    };
                }
            } else {
                // For routes via waypoints, calculate proportional price
                const allPoints = [
                    route.startLocation,
                    ...route.waypoints,
                    route.endLocation
                ];

                // Find indices of fromLocation and toLocation in the route
                // Use more flexible matching based on the city names
                const fromIndex = allPoints.findIndex(p => 
                    p.address.toLowerCase().includes(fromCity.toLowerCase())
                );
                const toIndex = allPoints.findIndex(p => 
                    p.address.toLowerCase().includes(toCity.toLowerCase())
                );

                if (fromIndex === -1 || toIndex === -1) {
                    console.error('Location not found in route points');
                    // If we can't find the locations in the route, just return with original price
                    return {
                        ...route,
                        distanceDetails: {
                            segmentType: 'unknown',
                            error: 'Could not find locations in route',
                            originalPrice,
                            adjustedPrice: originalPrice
                        }
                    };
                }

                // Extract relevant segment of the route
                points = allPoints.slice(
                    Math.min(fromIndex, toIndex),
                    Math.max(fromIndex, toIndex) + 1
                );

                // Create description of segments
                segmentDescription = points.map((point, idx) => {
                    if (idx === points.length - 1) return null;
                    return `${point.address} to ${points[idx + 1].address}`;
                }).filter(Boolean);


                try {
                    // Calculate proportional price for the segment
                    const routeCalculation = await calculateDistanceAndPrice(
                        points,
                        allPoints,
                        originalPrice
                    );

                    if (!routeCalculation) {
                        return {
                            ...route,
                            distanceDetails: {
                                segmentType: 'waypoint',
                                error: 'Could not calculate distance',
                                originalPrice,
                                segments: segmentDescription,
                                adjustedPrice: originalPrice // Use original price as fallback
                            }
                        };
                    }

                    const adjustedPricePerSeat = routeCalculation.price;

                    return {
                        ...route,
                        schedule: {
                            ...route.schedule,
                            pricePerSeat: adjustedPricePerSeat
                        },
                        totalPrice: adjustedPricePerSeat * passengers,
                        distanceDetails: {
                            segmentType: 'waypoint',
                            fullRouteDistance: routeCalculation.fullDistance,
                            segmentDistance: routeCalculation.segmentDistance,
                            segments: segmentDescription,
                            originalPrice,
                            adjustedPrice: adjustedPricePerSeat,
                            priceRatio: routeCalculation.priceRatio
                        }
                    };
                } catch (error) {
                    console.error('Error calculating distance for waypoint route:', error);
                    // Return the route with original price if distance calculation fails
                    return {
                        ...route,
                        distanceDetails: {
                            segmentType: 'waypoint',
                            error: 'Failed to calculate distance',
                            originalPrice,
                            segments: segmentDescription,
                            adjustedPrice: originalPrice
                        }
                    };
                }
            }
        } catch (error) {
            console.error('Error processing route:', error);
            // Return the original route if anything fails
            return route;
        }
    }));

    // Filter out any null or undefined values that might have resulted from errors
    const validRoutes = routesWithAdjustedPrices.filter(route => route);


    res.status(200).json({
        status: 'success',
        results: validRoutes.length,
        data: {
            routes: validRoutes
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

    // Create a session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 7. Calculate total amount
        const totalAmount = passengers.length * schedule.pricePerSeat;
        const advanceAmount = Math.round(totalAmount * 0.4); // 40% of total amount
        const remainingAmount = Math.round(totalAmount * 0.6); // 60% of total amount

        // Get route details before creating booking
        const route = await Route.findById(routeId).session(session);
        if (!route) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                status: 'fail',
                message: 'Route not found'
            });
        }

        // Set payment timeout (15 minutes from now)
        const paymentTimeoutDate = new Date();
        paymentTimeoutDate.setMinutes(paymentTimeoutDate.getMinutes() + 15);

        // Create booking with initialized paymentDetails and timeout
        const booking = await Booking.create([{
            userId: req.user.id,
            routeId,
            routeScheduleId,
            carId,
            passengers,
            selectedSeats,
            totalAmount,
            status: 'pending', // Always starts as pending
            paymentStatus: 'pending',
            paymentDetails: {
                advanceAmount,
                remainingAmount,
                totalAmount,
                paymentDate: null // Will be set when payment is confirmed
            },
            paymentTimeout: paymentTimeoutDate
        }], { session });
        
        const newBooking = booking[0]; // Get the first item since create returns an array with session

        // Create Razorpay order for advance payment (40% of total)
        try {
            // For testing/development - use minimal amount of 1 rupee
            const testMode = false; // Set to false in production
            const orderAmount = testMode ? 100 : advanceAmount * 100; // 1 rupee (100 paise) for testing, or real amount
            
            const order = await razorpay.orders.create({
                amount: orderAmount, // 1 rupee in paise for testing
                currency: 'INR',
                receipt: `receipt_${newBooking._id}`,
                notes: {
                    bookingId: newBooking._id.toString(),
                    routeId: routeId.toString(),
                    seats: selectedSeats.join(','),
                    passengers: passengers.length.toString(),
                    expiry: paymentTimeoutDate.toISOString(),
                    actualAmount: advanceAmount * 100, // Store actual amount for reference
                    testMode: testMode ? 'true' : 'false'
                }
            });


            // Store order ID in booking for easier lookup
            await Booking.findByIdAndUpdate(
                newBooking._id,
                { razorpayOrderId: order.id }
            );

            // Update seat availability in schedule
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
                    new: true,
                    session
                }
            );


            // Commit the transaction
            await session.commitTransaction();
            session.endSession();

            // Set up automatic cleanup for abandoned bookings after 15 minutes
            setTimeout(() => {
                cleanupAbandonedBooking(newBooking._id);
            }, 15 * 60 * 1000); // 15 minutes in milliseconds

            // After successful booking creation, send WhatsApp message
            const bookingDetails = `
🎫 Booking Confirmation (PENDING)
Booking ID: ${newBooking._id}
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
Please complete your advance payment in the next 15 minutes to confirm the booking.
            `;

            // Send message to each passenger
            for (const passenger of passengers) {
                if (passenger.phone) {
                    await sendWhatsAppMessage(passenger.phone, bookingDetails);
                }
            }

            // Send response
            res.status(201).json({
                status: 'success',
                data: {
                    booking: {
                        ...newBooking.toObject(),
                        razorpayOrderId: order.id
                    },
                    orderId: order.id,
                    bookingId: newBooking._id.toString(),
                    paymentTimeout: paymentTimeoutDate,
                    message: 'Booking created successfully, awaiting payment. Please complete payment within 15 minutes.'
                }
            });
        } catch (razorpayError) {
            console.error('Razorpay order creation error:', razorpayError);
            
            // Attempt to cleanup the booking since payment failed
            await Booking.findByIdAndDelete(newBooking._id);
            
            // Restore seat availability
            await RouteSchedule.findByIdAndUpdate(
                routeScheduleId,
                {
                    $inc: { availableSeats: passengers.length },
                    $set: {
                        'seatLayout.$[elem].isBooked': false
                    }
                },
                {
                    arrayFilters: [{ 'elem.seatNumber': { $in: selectedSeats } }]
                }
            );
            
            res.status(500).json({
                status: 'error',
                message: 'Failed to create payment order',
                details: razorpayError.error?.description || razorpayError.message
            });
        }
    } catch (error) {
        // Abort transaction on error
        await session.abortTransaction();
        session.endSession();
        
        console.error('Error in booking creation:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to create booking',
            details: error.message
        });
    }
});

exports.confirmPayment = catchAsync(async (req, res) => {
    const { bookingId, paymentId, orderId, signature } = req.body;


    if (!paymentId || !orderId || !signature) {
        return res.status(400).json({
            status: 'fail',
            message: 'Please provide paymentId, orderId, and signature'
        });
    }

    try {
        // First verify the payment signature
        const crypto = require('crypto');
        const key_secret = process.env.RAZORPAY_KEY_SECRET;
        
        // Creating hmac object 
        let hmac = crypto.createHmac('sha256', key_secret); 
        
        // Passing the data to be hashed
        hmac.update(orderId + "|" + paymentId);
        
        // Creating the hmac in the required format
        const generated_signature = hmac.digest('hex');
        
        // Verify signature
        if(signature !== generated_signature) {
            return res.status(400).json({
                status: 'fail',
                message: 'Payment verification failed: Invalid signature'
            });
        }
        
        // Fetch payment details from Razorpay
        let payment;
        try {
            payment = await razorpay.payments.fetch(paymentId);
        } catch (paymentFetchError) {
            console.error('Error fetching payment:', paymentFetchError);
            return res.status(400).json({
                status: 'fail',
                message: 'Unable to verify payment with Razorpay',
                details: handleRazorpayError(paymentFetchError)
            });
        }
        
        const successfulPaymentStatuses = ['captured', 'authorized'];
        
        if (!successfulPaymentStatuses.includes(payment.status)) {
            return res.status(400).json({
                status: 'fail',
                message: `Payment not successful. Status: ${payment.status}`,
                paymentStatus: payment.status
            });
        }

        // Find booking - either by bookingId or by orderId in notes
        let booking;
        
        if (bookingId) {
            // If bookingId is provided, find by ID
            booking = await Booking.findById(bookingId);
        } else {
            // If no bookingId, try to find by orderId
            
            // First get the order to access its notes
            let order;
            try {
                order = await razorpay.orders.fetch(orderId);
                
                
                if (order.notes && order.notes.bookingId) {
                    // If the order has the bookingId in notes, use it
                    booking = await Booking.findById(order.notes.bookingId);
                    
                } else {
                    // Last resort: look for booking with matching razorpayOrderId
                    booking = await Booking.findOne({ 
                        status: 'pending',
                        paymentStatus: 'pending'
                    }).sort({ createdAt: -1 }).limit(1);
                    
                }
            } catch (orderFetchError) {
                console.error('Error fetching order:', orderFetchError);
                return res.status(400).json({
                    status: 'fail',
                    message: 'Unable to verify order with Razorpay',
                    details: handleRazorpayError(orderFetchError)
                });
            }
        }

        if (!booking) {
            return res.status(404).json({
                status: 'fail',
                message: 'Booking not found'
            });
        }
        
        // Check if booking is still in pending state
        if (booking.status !== 'pending') {
            return res.status(400).json({
                status: 'fail',
                message: `Cannot confirm payment for booking in '${booking.status}' state`,
                bookingStatus: booking.status
            });
        }
        
        // Check if booking has expired (payment timeout)
        if (booking.paymentTimeout && new Date() > new Date(booking.paymentTimeout)) {
            return res.status(400).json({
                status: 'fail',
                message: 'Booking payment time has expired',
                bookingStatus: 'expired'
            });
        }

        let advanceAmount = payment.amount / 100;
        let isTestMode = true;

        try {
            if (order.notes && order.notes.testMode === 'true') {
                isTestMode = true;
                if (order.notes.actualAmount) {
                    advanceAmount = parseInt(order.notes.actualAmount) / 100;
                }
            }
        } catch (error) {
            advanceAmount = payment.amount / 100;
        }

        const remainingAmount = booking.totalAmount - advanceAmount;
        
        // Start a session for transaction
        const session = await mongoose.startSession();
        session.startTransaction();
        
        try {
            // Update booking status to confirmed and update payment details
            const updatedBooking = await Booking.findByIdAndUpdate(
                booking._id,
                {
                    status: 'confirmed', // Now we confirm the booking
                    paymentStatus: 'partially_paid',
                    razorpayPaymentId: paymentId,
                    razorpayOrderId: orderId,
                    razorpaySignature: signature,
                    paymentDetails: {
                        ...payment,
                        advanceAmount,
                        remainingAmount,
                        totalAmount: booking.totalAmount,
                        paymentDate: new Date()
                    }
                },
                { 
                    new: true,
                    session
                }
            );
            
            // Commit the transaction
            await session.commitTransaction();
            session.endSession();

            // After successful payment confirmation, send WhatsApp message
            const paymentConfirmation = `
💳 Payment Confirmation
Booking ID: ${booking._id}
Payment ID: ${paymentId}
${isTestMode ? '🧪 TEST MODE PAYMENT' : ''}
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
                if (passenger.phone) {
                    await sendWhatsAppMessage(passenger.phone, paymentConfirmation);
                }
            }

            res.status(200).json({
                status: 'success',
                data: {
                    booking: updatedBooking,
                    paymentSummary: {
                        advanceAmount,
                        remainingAmount,
                        totalAmount: booking.totalAmount,
                        paymentDate: new Date(),
                        isTestMode
                    },
                    message: isTestMode ? 
                        'Test payment confirmed and booking updated' : 
                        'Advance payment confirmed and booking updated'
                }
            });
        } catch (error) {
            // Abort transaction on error
            await session.abortTransaction();
            session.endSession();
            throw error; // Rethrow to be caught by outer catch block
        }
    } catch (error) {
        console.error('Error in payment confirmation:', error);
        
        // Check if it's a Razorpay error
        if (error.statusCode && error.error) {
            return res.status(error.statusCode).json({
                status: 'fail',
                message: 'Razorpay error',
                error: handleRazorpayError(error)
            });
        }
        
        // Generic error handling
        res.status(500).json({
            status: 'error',
            message: 'Failed to process payment confirmation',
            details: error.message
        });
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
      return res.status(404).json({
        status: 'fail',
        message: 'No car found for this driver'
      });
    }


    // Set the date range to include yesterday, today, and tomorrow
    const today = new Date();
    const startOfYesterday = new Date(today);
    startOfYesterday.setDate(today.getDate() - 1);
    startOfYesterday.setUTCHours(0, 0, 0, 0);

    const endOfTomorrow = new Date(today);
    endOfTomorrow.setDate(today.getDate() + 1);
    endOfTomorrow.setUTCHours(23, 59, 59, 999);


    // Find route schedules for the driver's car within the specified date range
    const routeSchedules = await RouteSchedule.find({
      carId: car._id, // Ensure this field exists in RouteSchedule
      date: {
        $gte: startOfYesterday,
        $lte: endOfTomorrow
      },
      status: 'active'
    });


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


    // Format the response to include travel date
    const formattedBookings = bookings.map(booking => {

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

      return formattedBooking;
    });


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
