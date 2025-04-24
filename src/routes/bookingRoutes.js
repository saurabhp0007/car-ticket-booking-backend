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
router.post('/confirm', bookingController.confirmPayment);
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

// Protect all routes and ensure only drivers can access
router.use(roleMiddleware(['driver']));

// Example route definition
router.get('/driver-schedules', bookingController.getDriverRouteSchedules);

// Define the route for fetching bookings with travel date
router.get('/bookings-with-travel-date', bookingController.getDriverBookingsWithTravelDate);

// Ensure all routes have valid callback functions
// Add other routes as needed
// router.get('/another-route', bookingController.anotherFunction);

module.exports = router;
