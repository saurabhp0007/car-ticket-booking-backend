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
  UserController.getAllUsers
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
  UserController.getAssignedDrivers 
);

// Route for requesting admin role
router.post('/request-admin-role', 
  authMiddleware, 
  UserController.requestAdminRole
);

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

// Route for getting pending driver requests (superadmin only)
router.get('/pending-driver-requests',
  authMiddleware,
  roleMiddleware(['superadmin']),
  UserController.getPendingDriverRequests
);

// Route for approving/rejecting driver requests (superadmin only)
router.post('/approve-driver-request',
  authMiddleware,
  roleMiddleware(['superadmin']),
  UserController.approveDriverAssignment
);

// Route for getting all admins (superadmin only)
router.get('/admins',
  authMiddleware,
  roleMiddleware(['superadmin']),
  UserController.getAllAdmins
);

// Route for disqualifying admin (superadmin only)
router.post('/disqualify-admin',
  authMiddleware,
  roleMiddleware(['superadmin']),
  UserController.disqualifyAdmin
);

// Route for searching users by email (admin only)
router.get('/search', 
  authMiddleware, 
  roleMiddleware(['admin', 'superadmin']), 
  UserController.searchUsers
);

// Route for getting pending admin requests (superadmin only)
router.get('/pending-admin-requests',
  authMiddleware,
  roleMiddleware(['superadmin']),
  UserController.getPendingAdminRequests
);

// Route for approving/rejecting admin requests (superadmin only)
router.post('/approve-admin-request',
  authMiddleware,
  roleMiddleware(['superadmin']),
  UserController.approveAdminRequest
);

module.exports = router;