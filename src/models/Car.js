const mongoose = require('mongoose');

const carSchema = new mongoose.Schema({
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    make: {
        type: String,
        required: [true, 'Car make is required']
    },
    model: {
        type: String,
        required: [true, 'Car model is required']
    },
    year: {
        type: Number,
        required: [true, 'Car year is required']
    },
    licensePlate: {
        type: String,
        required: [true, 'License plate is required'],
        unique: true
    },
    insuranceNumber: {
        type: String,
        required: [true, 'Insurance number is required']
    },
    registrationNumber: {
        type: String,
        required: [true, 'Registration number is required']
    },
    seater: {
        type: Number,
        required: [true, 'Number of seats is required']
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    }
});

module.exports = mongoose.model('Car', carSchema); 