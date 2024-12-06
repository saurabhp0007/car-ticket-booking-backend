const express = require('express');
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

const router = express.Router();

// Protect all routes after this middleware
router.use(authMiddleware);

// Public routes (no auth required)
router.post('/search', bookingController.searchAvailableRoutes);

// Protected routes (auth required)
router.post('/', bookingController.createBooking);
router.get('/my-bookings', bookingController.getMyBookings);

// Admin Routes (requires admin role)
router.get('/admin/bookings', 
    authMiddleware, 
    roleMiddleware(['admin']), 
    bookingController.getAdminBookings
);

router.get('/admin/bookings/:id', 
    authMiddleware, 
    roleMiddleware(['admin']), 
    bookingController.getBookingDetail
);

module.exports = router;
