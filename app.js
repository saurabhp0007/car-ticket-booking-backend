const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const connectDB = require('./src/config/database');

// Import routes
const userRoutes = require('./src/routes/userRoutes');
const carRoutes = require('./src/routes/carRoutes');
const routeRoutes = require('./src/routes/routeRoutes');
const bookingRoutes = require('./src/routes/bookingRoutes');
const routeScheduleRoutes = require('./src/routes/routeScheduleRoutes');

// Initialize express app
const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enable CORS
app.use(cors({
  origin: [
    'https://www.subhamyaatravels.com',
    'https://subhamyaatravels.com',
    'https://car-reset-password-7bjmo96yi-saurabhs-projects-2660e0f6.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true
}));


// Initialize Socket.IO with CORS options
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH"],
    credentials: true
  }
});

// Socket.IO setup
const connectedUsers = new Map();
app.set('io', io);
app.set('connectedUsers', connectedUsers);

io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId;
  
  if (userId) {
    connectedUsers.set(userId, socket.id);
    console.log(`User connected: ${userId}`);
  }

  socket.onAny((event, ...args) => {
    console.log('Socket Event:', {
      event,
      socketId: socket.id,
      userId: userId,
      args,
      timestamp: new Date().toISOString()
    });
  });
  
  socket.on('disconnect', (reason) => {
    
    if (userId) {
      connectedUsers.delete(userId);
      console.log(`User disconnected: ${userId}`);
    }
  });

  socket.on('error', (error) => {
    console.error('Socket Error:', {
      userId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  });
});

// Connect to Database
connectDB();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/cars', carRoutes);
app.use('/api/v1/routes', routeRoutes);
app.use('/api/v1/bookings', bookingRoutes);
app.use('/api/v1/route-schedules', routeScheduleRoutes);

// Base route
app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'Welcome to Car Booking API'
  });
});

// Error Handling
app.use((err, req, res, next) => {
  console.error('Error:', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    timestamp: new Date().toISOString()
  });

  res.status(err.status || 500).json({
    status: 'error',
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
});

// Start server
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log({
    message: 'Server Started',
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

module.exports = app;
