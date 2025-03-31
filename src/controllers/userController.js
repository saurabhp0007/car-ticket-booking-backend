const User = require('../models/User');
const JWTService = require('../services/jwtService');
const crypto = require('crypto');
const sendEmail = require('../services/emailService');

class UserController {
  static async signup(req, res) {
    try {
      const { name, email, password, phone, role } = req.body;
      
      // Validate required fields
      const validationErrors = {};
      
      if (!name || name.trim() === '') {
        validationErrors.name = 'Name is required';
      }
      
      if (!email) {
        validationErrors.email = 'Email is required';
      } else {
        // Check if email is already registered
        const existingEmail = await User.findOne({ email });
        if (existingEmail) {
          validationErrors.email = 'Email is already registered';
        }
      }
      
      if (!password) {
        validationErrors.password = 'Password is required';
      } else if (password.length < 6) {
        validationErrors.password = 'Password must be at least 6 characters';
      }
      
      if (!phone) {
        validationErrors.phone = 'Phone number is required';
      }
      
      // If validation errors exist, return them
      if (Object.keys(validationErrors).length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: validationErrors
        });
      }

      // Create new user
      const user = await User.create({
        name,
        email,
        password,
        phone,
        role
      });

      // Generate token
      const token = JWTService.generateToken(user);

      res.status(201).json({
        success: true,
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Server error during signup',
        error: error.message
      });
    }
  }

  static async login(req, res) {
    try {
      const { email, password } = req.body;

      // Find user and select password
      const user = await User.findOne({ email }).select('+password');

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      // Check password
      const isMatch = await user.checkPassword(password);

      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      // If no role specified during registration, default to 'user'
      if (!user.role) {
        user.role = 'user';
        await user.save();
      }

      // Generate token
      const token = JWTService.generateToken(user);

      res.json({
        success: true,
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          assignedAdmin: user.assignedAdmin
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Server error during login',
        error: error.message
      });
    }
  }

  static async logout(req, res) {
    try {
      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Server error during logout',
        error: error.message
      });
    }
  }

  static async getProfile(req, res) {
    try {
      const user = await User.findById(req.user._id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Server error while fetching profile',
        error: error.message
      });
    }
  }

  static async updateProfile(req, res) {
    try {
      const updates = {
        name: req.body.name,
        phone: req.body.phone
      };

      if (req.body.email) {
        const existingUser = await User.findOne({ 
          email: req.body.email,
          _id: { $ne: req.user._id }
        });
        
        if (existingUser) {
          return res.status(400).json({
            success: false,
            message: 'Email already in use'
          });
        }
        updates.email = req.body.email;
      }

      if (req.body.password) {
        updates.password = req.body.password;
      }

      const user = await User.findByIdAndUpdate(
        req.user._id,
        updates,
        { new: true, runValidators: true }
      );

      res.json({
        success: true,
        message: 'Profile updated successfully',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Server error while updating profile',
        error: error.message
      });
    }
  }

  static async forgotPassword(req, res) {
    try {
      const { email } = req.body;
      
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Generate reset token
      const resetToken = user.createPasswordResetToken();
      await user.save({ validateBeforeSave: false });

      // Create reset URL
      const resetUrl = `https://car-reset-password.vercel.app/reset-password/${resetToken}`;

      const message = `
        Forgot your password? Click the link below to reset your password:
        
        ${resetUrl}
        
        If you didn't request this, please ignore this email.
        
        This link will expire in 10 minutes.
      `;

      try {
        await sendEmail({
          email: user.email,
          subject: 'Your password reset token (valid for 10 min)',
          message
        });

        res.status(200).json({
          success: true,
          message: 'Token sent to email!'
        });
      } catch (err) {
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save({ validateBeforeSave: false });

        return res.status(500).json({
          success: false,
          message: 'There was an error sending the email. Try again later!'
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Server error during password reset request',
        error: error.message
      });
    }
  }

  static async resetPassword(req, res) {
    try {
      // Get token from params and get hashed version
      const resetToken = crypto
        .createHash('sha256')
        .update(req.params.token)
        .digest('hex');

      const user = await User.findOne({
        passwordResetToken: resetToken,
        passwordResetExpires: { $gt: Date.now() }
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Token is invalid or has expired'
        });
      }

      // Set new password
      user.password = req.body.password;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save();

      // Generate new JWT
      const token = JWTService.generateToken(user);

      res.status(200).json({
        success: true,
        message: 'Password reset successful',
        token
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Server error during password reset',
        error: error.message
      });
    }
  }

  static async getAllUsers(req, res) {
    try {
      const users = await User.find({}).select('-password');
      
      res.json({
        success: true,
        count: users.length,
        users
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching users',
        error: error.message
      });
    }
  }

  static async requestAdminRole(req, res) {
    try {
      const user = await User.findById(req.user._id);
      const { message } = req.body; // Optional message from the user

      // Check if there's already a pending request
      if (user.adminRequest && user.adminRequest.status === 'pending') {
        return res.status(400).json({
          success: false,
          message: 'You already have a pending admin request'
        });
      }

      // Update user with admin request
      user.adminRequest = {
        status: 'pending',
        requestedAt: new Date(),
        message: message || 'Request for admin privileges'
      };
      await user.save();

      // Send email to superadmin
      const superAdmin = await User.findOne({ role: 'superadmin' });
      if (superAdmin) {
        const emailMessage = `
          User ${user.name} (${user.email}) has requested admin privileges.
          User ID: ${user._id}
          Message: ${message || 'No message provided'}
          
          To approve this request, please check the admin dashboard.
        `;

        await sendEmail({
          email: superAdmin.email,
          subject: 'New Admin Role Request',
          message: emailMessage
        });
      }

      // Emit socket event if available
      const io = req.app.get('io');
      if (io) {
        io.emit('adminRequest', {
          type: 'new',
          userId: user._id,
          userName: user.name,
          status: 'pending'
        });
      }

      res.json({
        success: true,
        message: 'Admin role request submitted successfully',
        data: {
          requestStatus: 'pending',
          requestedAt: user.adminRequest.requestedAt
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error requesting admin role',
        error: error.message
      });
    }
  }

  static async updateUserRole(req, res) {
    try {
      const { userId, newRole, approved } = req.body;
      
      const user = await User.findByIdAndUpdate(
        userId,
        { role: newRole },
        { new: true }
      ).select('-password');
  
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
  
      const io = req.app.get('io');
      const connectedUsers = req.app.get('connectedUsers');
      
      if (newRole === 'admin' && approved) {
        const eventData = {
          userId: user._id.toString(),
          message: 'Congratulations! Your admin role request has been approved.Please relogin',
          timestamp: new Date().toISOString()
        };
        
        // Broadcast to all clients and specifically to the target user
        io.emit('adminApproved', eventData);
      }
  
      res.json({
        success: true,
        message: 'User role updated successfully',
        user
      });
    } catch (error) {
      console.error('Error in updateUserRole:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating user role',
        error: error.message
      });
    }
  }

  static async getAssignedDrivers(req, res) {
    try {
      // Get the admin's ID from the authenticated user
      const adminId = req.user._id;

      // Find all users who are drivers and assigned to this admin
      const drivers = await User.find({
        role: 'driver',
        assignedAdmin: adminId,
        isActive: true
      }).select('name email phone status isActive createdAt');

      res.status(200).json({
        success: true,
        count: drivers.length,
        data: drivers
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching assigned drivers',
        error: error.message
      });
    }
  }

  static async requestDriverAssignment(req, res) {
    try {
      
      const { driverId } = req.body;
      const adminId = req.user._id; // From auth middleware


      // Validate if driver ID is provided
      if (!driverId) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a driver ID'
        });
      }

      // Check if driver exists and is not already assigned
      const driver = await User.findById(driverId);

      if (!driver) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found'
        });
      }

      if (driver.assignedAdmin) {
        return res.status(400).json({
          success: false,
          message: 'Driver is already assigned to an admin'
        });
      }

      // Check if user is actually a driver or can become a driver
      if (driver.role !== 'driver' && driver.role !== 'user') {
        return res.status(400).json({
          success: false,
          message: 'Selected user cannot be assigned as a driver'
        });
      }

      // Create or update driver request
      driver.driverRequest = {
        status: 'pending',
        requestedBy: adminId,
        requestedAt: new Date()
      };
      await driver.save();

      // Get socket.io instance if available
      const io = req.app.get('io');
      if (io) {
        io.emit('driverRequest', {
          type: 'new',
          driverId: driver._id,
          adminId: adminId,
          status: 'pending'
        });
      }
      return res.status(200).json({
        success: true,
        message: 'Driver assignment request submitted successfully',
        data: {
          driverId: driver._id,
          status: 'pending',
          requestedAt: driver.driverRequest.requestedAt
        }
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Error processing driver assignment request',
        error: error.message
      });
    }
  }

  static async getPendingDriverRequests(req, res) {
    try {
      const pendingRequests = await User.find({
        'driverRequest.status': 'pending'
      })
      .populate('driverRequest.requestedBy', 'name email')
      .select('name email driverRequest createdAt');

      res.json({
        success: true,
        count: pendingRequests.length,
        data: pendingRequests.map(user => ({
          userId: user._id,
          userName: user.name,
          userEmail: user.email,
          requestedBy: {
            adminId: user.driverRequest.requestedBy._id,
            adminName: user.driverRequest.requestedBy.name,
            adminEmail: user.driverRequest.requestedBy.email
          },
          requestedAt: user.driverRequest.requestedAt
        }))
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching pending driver requests',
        error: error.message
      });
    }
  }

  static async approveDriverAssignment(req, res) {
    try {
      const { userId, approved, adminId } = req.body;

      const user = await User.findById(userId);
      if (!user || user.driverRequest?.status !== 'pending') {
        return res.status(404).json({
          success: false,
          message: 'No pending driver request found'
        });
      }

      // Verify the admin exists
      const admin = await User.findOne({ _id: adminId, role: 'admin' });
      if (!admin) {
        return res.status(404).json({
          success: false,
          message: 'Admin not found'
        });
      }

      if (approved) {
        // Approve the request
        user.role = 'driver';
        user.assignedAdmin = adminId;
        user.driverRequest.status = 'approved';
      } else {
        // Reject the request
        user.driverRequest.status = 'rejected';
      }

      await user.save();

      // Get socket.io instance
      const io = req.app.get('io');
      
      if (approved) {
        // Notify the admin and user through socket
        const eventData = {
          userId: user._id.toString(),
          adminId: adminId.toString(),
          message: `Driver request for ${user.name} has been approved`,
          timestamp: new Date().toISOString()
        };
        
        io?.emit('driverRequestApproved', eventData);
      }

      res.json({
        success: true,
        message: approved ? 'Driver request approved successfully' : 'Driver request rejected',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          assignedAdmin: user.assignedAdmin,
          requestStatus: user.driverRequest.status
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error processing driver request',
        error: error.message
      });
    }
  }

  static async disqualifyDriver(req, res) {
    try {
      const { driverId } = req.body;
      const adminId = req.user.id;

      // Find the driver and verify they're assigned to this admin
      const driver = await User.findOne({
        _id: driverId,
        role: 'driver',
        assignedAdmin: adminId
      });

      if (!driver) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found or not assigned to you'
        });
      }

      // Update driver: remove admin assignment and change role back to 'user'
      driver.assignedAdmin = undefined;
      driver.role = 'user';
      await driver.save();

      // Optionally, emit a socket event to notify the driver
      req.app.get('io')?.emit('driverDisqualified', {
        userId: driver._id,
        message: 'You have been disqualified as a driver'
      });

      res.status(200).json({
        success: true,
        message: 'Driver has been disqualified successfully',
        data: {
          userId: driver._id,
          name: driver.name,
          email: driver.email
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error disqualifying driver',
        error: error.message
      });
    }
  }

  static async getAllAdmins(req, res) {
    try {
      const admins = await User.find({ role: 'admin' })
        .select('name email phone createdAt')
        .lean();

      const adminsWithDriverCount = await Promise.all(
        admins.map(async (admin) => {
          const driverCount = await User.countDocuments({
            role: 'driver',
            assignedAdmin: admin._id
          });
          return { ...admin, driverCount };
        })
      );

      res.status(200).json({
        success: true,
        count: admins.length,
        data: adminsWithDriverCount
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching admins',
        error: error.message
      });
    }
  }

  static async disqualifyAdmin(req, res) {
    try {
      const { adminId } = req.body;

      // Find the admin
      const admin = await User.findOne({
        _id: adminId,
        role: 'admin'
      });

      if (!admin) {
        return res.status(404).json({
          success: false,
          message: 'Admin not found'
        });
      }

      // Find all drivers assigned to this admin
      const assignedDrivers = await User.find({
        role: 'driver',
        assignedAdmin: adminId
      });

      // Update all assigned drivers to regular users
      await User.updateMany(
        { assignedAdmin: adminId },
        { 
          $set: { role: 'user' },
          $unset: { assignedAdmin: "" }
        }
      );

      // Change admin to regular user
      admin.role = 'user';
      await admin.save();

      // Get socket.io instance
      const io = req.app.get('io');
      
      // Notify the admin and all affected drivers
      const eventData = {
        adminId: admin._id.toString(),
        message: 'You have been disqualified as an admin',
        timestamp: new Date().toISOString()
      };
      
      io?.emit('adminDisqualified', eventData);

      // Notify each affected driver
      assignedDrivers.forEach(driver => {
        io?.emit('driverDisqualified', {
          userId: driver._id.toString(),
          message: 'You have been disqualified as a driver due to admin disqualification',
          timestamp: new Date().toISOString()
        });
      });

      res.status(200).json({
        success: true,
        message: 'Admin and associated drivers have been disqualified successfully',
        data: {
          admin: {
            id: admin._id,
            name: admin.name,
            email: admin.email
          },
          affectedDriversCount: assignedDrivers.length
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error disqualifying admin',
        error: error.message
      });
    }
  }

  static async searchUsers(req, res) {
    try {

      const { email } = req.query;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Please provide an email to search'
        });
      }

      // First, let's try to find the user with just the email
      const simpleQuery = { email: { $regex: email, $options: 'i' } };
      
      const allUsers = await User.find(simpleQuery).lean();

      // Now let's add role condition
      const queryWithRole = {
        email: { $regex: email, $options: 'i' },
        role: { $in: ['user', null] }  // Include users with role 'user' or no role
      };
      
      const users = await User.find(queryWithRole)
        .select('name email phone role createdAt')
        .lean();

      res.status(200).json({
        success: true,
        count: users.length,
        data: users.map(user => ({
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          createdAt: user.createdAt
        }))
      });

    } catch (error) {
      console.error('Error in searchUsers:', error);
      res.status(500).json({
        success: false,
        message: 'Error searching users',
        error: error.message
      });
    }
  }

  static async getPendingAdminRequests(req, res) {
    try {
      const pendingRequests = await User.find({
        'adminRequest.status': 'pending'
      }).select('name email adminRequest createdAt');

      res.json({
        success: true,
        count: pendingRequests.length,
        data: pendingRequests.map(user => ({
          userId: user._id,
          userName: user.name,
          userEmail: user.email,
          requestDetails: {
            message: user.adminRequest.message,
            requestedAt: user.adminRequest.requestedAt
          }
        }))
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching pending admin requests',
        error: error.message
      });
    }
  }

  static async approveAdminRequest(req, res) {
    try {
      const { userId, status, message } = req.body;

      if (!userId || !status || !['approved', 'rejected'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide valid userId and status (approved/rejected)'
        });
      }

      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (!user.adminRequest || user.adminRequest.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: 'No pending admin request found for this user'
        });
      }

      // Update user's admin request status
      user.adminRequest.status = status;
      
      // If approved, update user role to admin
      if (status === 'approved') {
        user.role = 'admin';
      }

      await user.save();

      // Emit socket event if available
      const io = req.app.get('io');
      if (io) {
        const socketId = req.app.get('connectedUsers').get(userId.toString());
        if (socketId) {
          io.to(socketId).emit('adminRequestUpdate', {
            status,
            message: message || `Your admin request has been ${status}`
          });
        }
      }

      res.json({
        success: true,
        message: `Admin request ${status} successfully`,
        data: {
          userId: user._id,
          status: user.adminRequest.status,
          role: user.role
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error processing admin request',
        error: error.message
      });
    }
  }
}

module.exports = UserController;