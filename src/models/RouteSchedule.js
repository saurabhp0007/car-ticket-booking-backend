const mongoose = require('mongoose');

const seatSchema = new mongoose.Schema({
    seatNumber: {
        type: String,
        required: true
    },
    isBooked: {
        type: Boolean,
        default: false
    }
});

const routeScheduleSchema = new mongoose.Schema({
    routeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Route',
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    startTime: {
        type: String,
        required: true
    },
    totalSeats: {
        type: Number,
        required: true
    },
    availableSeats: {
        type: Number,
        required: true
    },
    pricePerSeat: {
        type: Number,
        required: true
    },
    seatLayout: {
        type: Array,
        required: true
    },
    status: {
        type: String,
        default: 'active'
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Create index for quick searches
routeScheduleSchema.index({ routeId: 1, date: 1 });

// Middleware to ensure availableSeats doesn't exceed totalSeats
routeScheduleSchema.pre('save', function(next) {
    if (this.availableSeats > this.totalSeats) {
        this.availableSeats = this.totalSeats;
    }
    next();
});

// Virtual populate bookings
routeScheduleSchema.virtual('bookings', {
    ref: 'Booking',
    foreignField: 'routeScheduleId',
    localField: '_id'
});

const RouteSchedule = mongoose.model('RouteSchedule', routeScheduleSchema);

module.exports = RouteSchedule; 