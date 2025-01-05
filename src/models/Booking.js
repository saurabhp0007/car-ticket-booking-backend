const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: [true, 'Booking must belong to a User']
    },
    routeId: {
        type: mongoose.Schema.ObjectId,
        ref: 'Route',
        required: [true, 'Booking must belong to a Route']
    },
    routeScheduleId: {
        type: mongoose.Schema.ObjectId,
        ref: 'RouteSchedule',
        required: [true, 'Booking must have a Schedule']
    },
    carId: {
        type: mongoose.Schema.ObjectId,
        ref: 'Car',
        required: [true, 'Booking must have a Car']
    },
    passengers: [{
        name: {
            type: String,
            required: [true, 'Passenger name is required']
        },
        age: {
            type: Number,
            required: [true, 'Passenger age is required']
        },
        gender: {
            type: String,
            required: [true, 'Passenger gender is required'],
            enum: ['male', 'female', 'other']
        },
        phone: {
            type: String,
            required: [true, 'Passenger phone number is required']
        }
    }],
    selectedSeats: [{
        type: String,
        required: [true, 'Selected seats are required']
    }],
    totalAmount: {
        type: Number,
        required: [true, 'Booking must have a total amount']
    },
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'cancelled'],
        default: 'confirmed'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'pending'
    },
    cachedScheduleData: {
        date: Date,
        startTime: String,
        totalSeats: Number,
        availableSeats: Number,
        pricePerSeat: Number
    },
    scheduleDeleted: {
        type: Boolean,
        default: false
    },
    scheduleDeletedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;
