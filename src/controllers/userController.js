const User = require('../models/User');
const JWTService = require('../services/jwtService');
const crypto = require('crypto');
const sendEmail = require('../services/emailService');

class UserController {
  static async signup(req, res) {
    try {
      const { name, email, password, phone, role } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User already exists'
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
      const resetUrl = `${req.protocol}://${req.get('host')}/api/v1/users/reset-password/${resetToken}`;

      const message = `Forgot your password? Submit a PATCH request with your new password to: ${resetUrl}.\nIf you didn't forget your password, please ignore this email!`;

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
      
      // Send email to superadmin
      const superAdmin = await User.findOne({ role: 'superadmin' });
      if (!superAdmin) {
        return res.status(404).json({
          success: false,
          message: 'Super admin not found'
        });
      }

      const message = `
        User ${user.name} (${user.email}) has requested admin privileges.
        User ID: ${user._id}
        
        To approve this request, make a PUT request to:
        /api/v1/users/update-role
        with body:
        {
          "userId": "${user._id}",
          "newRole": "admin",
          "approved": true
        }
      `;

      await sendEmail({
        email: superAdmin.email,
        subject: 'New Admin Role Request',
        message
      });

      res.json({
        success: true,
        message: 'Admin role request sent successfully'
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
      const { email } = req.body;
      
      // Find user by email
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User with this email not found'
        });
      }

      // Check if user is already a driver
      if (user.role === 'driver') {
        return res.status(400).json({
          success: false,
          message: 'User is already a driver'
        });
      }

      // Send email to superadmin
      const superAdmin = await User.findOne({ role: 'superadmin' });
      if (!superAdmin) {
        return res.status(404).json({
          success: false,
          message: 'Super admin not found'
        });
      }

      const message = `
        Admin ${req.user.name} (${req.user.email}) has requested to assign user:
        
        Name: ${user.name}
        Email: ${user.email}
        User ID: ${user._id}
        
        as a driver.
        
        To approve this request, make a PUT request to:
        /api/v1/users/approve-driver with body:
        {
          "userId": "${user._id}",
          "approved": true
        }
      `;

      await sendEmail({
        email: superAdmin.email,
        subject: 'Driver Assignment Request',
        message
      });

      res.json({
        success: true,
        message: 'Driver assignment request sent successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error requesting driver assignment',
        error: error.message
      });
    }
  }

  static async approveDriverAssignment(req, res) {
    try {
      const { userId, approved, adminId } = req.body;

      if (!approved) {
        return res.status(400).json({
          success: false,
          message: 'Approval is required'
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

      const user = await User.findByIdAndUpdate(
        userId,
        { 
          role: 'driver',
          assignedAdmin: adminId 
        },
        { new: true }
      ).select('-password');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        message: 'User assigned as driver successfully',
        user
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error approving driver assignment',
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
}

module.exports = UserController;