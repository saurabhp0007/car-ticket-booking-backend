const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// Common Routes (no auth required)
router.post('/signup', UserController.signup);  // Everyone signs up as regular user
router.post('/login', UserController.login);
router.post('/forgot-password', UserController.forgotPassword);
router.patch('/reset-password/:token', UserController.resetPassword);

// SuperAdmin Routes (requires superAdmin role)
router.get('/all', 
  authMiddleware, 
  roleMiddleware(['superadmin']), 
  UserController.getAllUsers  // SuperAdmin can see all users
);

router.patch('/assign-role', 
  authMiddleware, 
  roleMiddleware(['superAdmin']), 
  UserController.updateUserRole  // SuperAdmin can change roles
);

// Route for updating user role (requires superAdmin role)
router.put('/update-role', 
  authMiddleware, 
  roleMiddleware(['superadmin']), 
  UserController.updateUserRole
);

// Admin Routes (requires admin role)
router.get('/drivers', 
  authMiddleware, 
  roleMiddleware(['admin']), 
  UserController.getAssignedDrivers  // Admin can see only their drivers
);

// Route for requesting admin role
router.post('/request-admin-role', authMiddleware, UserController.requestAdminRole);

// Route for admin to request driver assignment
router.post('/request-driver-assignment',
  authMiddleware, 
  roleMiddleware(['admin']), 
  UserController.requestDriverAssignment
);

// Route for superadmin to approve driver assignment
router.put('/approve-driver', 
  authMiddleware, 
  roleMiddleware(['superadmin']), 
  UserController.approveDriverAssignment
);

// Route for admin to disqualify/unassign a driver
router.post('/disqualify-driver',
  authMiddleware,
  roleMiddleware(['admin']),
  UserController.disqualifyDriver
);

module.exports = router;