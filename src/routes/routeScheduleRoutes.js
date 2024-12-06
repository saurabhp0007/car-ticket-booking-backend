const express = require('express');
const routeScheduleController = require('../controllers/routeScheduleController');
const authMiddleware = require('../middlewares/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(authMiddleware);

// Routes
router.post('/', routeScheduleController.createRouteSchedule);
router.get('/', routeScheduleController.getRouteSchedules);
router.get('/:routeScheduleId/seats', routeScheduleController.getAvailableSeats);
router.patch('/:id', routeScheduleController.updateRouteSchedule);
router.get('/:routeScheduleId', routeScheduleController.getRouteScheduleById);
router.get('/:routeId', routeScheduleController.getRouteSchedules);
router.delete('/:routeId', routeScheduleController.deleteRouteSchedule);

module.exports = router; 