const mongoose = require('mongoose');

const routeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Route name is required']
    },
    carId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Car',
        required: true
    },
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    startLocation: {
        type: { type: String, default: 'Point' },
        coordinates: [Number],
        address: String
    },
    endLocation: {
        type: { type: String, default: 'Point' },
        coordinates: [Number],
        address: String
    },
    waypoints: [{
        type: { type: String, default: 'Point' },
        coordinates: [Number],
        address: String
    }],
    schedule: [{
        dayOfWeek: {
            type: Number,
            min: 0,
            max: 6,
            required: true
        },
        startTime: {
            type: String,
            required: true
        },
        endTime: {
            type: String,
            required: true
        }
    }],
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Route', routeSchema);
