const express = require('express');
const router = express.Router();
const carController = require('../controllers/carController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// Admin Routes (requires admin role)
router.post('/register', 
    authMiddleware, 
    roleMiddleware(['admin']), 
    carController.registerCar
);

// Update car route
router.put('/:id', 
    authMiddleware, 
    carController.updateCar
);

// Delete car route
router.delete('/:carId', 
    authMiddleware,
    roleMiddleware(['admin']),
    carController.deleteCar
);

router.get('/get-cars', authMiddleware, carController.getAdminCars);

module.exports = router;
