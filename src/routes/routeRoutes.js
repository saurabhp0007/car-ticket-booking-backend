const express = require('express');
const routeController = require('../controllers/routeController');
const authMiddleware = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(authMiddleware);

router
    .route('/')
    .post(routeController.createRoute);

router
    .route('/car/:carId')
    .get(routeController.getCarRoutes);

router
    .route('/:routeId')
    .patch(routeController.updateRoute)
    .delete(routeController.deleteRoute);

router.get('/:routeId/distance', routeController.getRouteDistance);

module.exports = router;
