module.exports = {
    JWT_SECRET: process.env.JWT_SECRET || 'your_jwt_secret',
    JWT_EXPIRY: '7d',
    USER_ROLES: {
      USER: 'user',
      DRIVER: 'driver',
      ADMIN: 'admin',
      OWNER: 'owner'
    }
  };