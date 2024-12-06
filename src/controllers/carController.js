const Car = require('../models/Car'); // You'll need to create this model
const Route = require('../models/Route');
const RouteSchedule = require('../models/RouteSchedule');
const catchAsync = require('../utils/catchAsync'); // Assuming you have this utility

exports.registerCar = catchAsync(async (req, res) => {
    const {
        make,
        model,
        year,
        licensePlate,
        insuranceNumber,
        registrationNumber,
        seater
    } = req.body;

    // Create new car registration linked to the admin user
    const car = await Car.create({
        adminId: req.user.id, // From auth middleware
        make,
        model,
        year,
        licensePlate,
        insuranceNumber,
        registrationNumber,
        seater,
        status: 'active'
    });

    res.status(201).json({
        status: 'success',
        data: {
            car
        }
    });
});

exports.updateCar = catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const { licensePlate, seater } = req.body;

    // Validate seater if provided
    if (seater && (seater < 2 || seater > 50)) {
        const error = new Error('Seater capacity must be between 2 and 50');
        error.statusCode = 400;
        return next(error);
    }

    // Check if another car with the same license plate exists
    const existingCar = await Car.findOne({ licensePlate, _id: { $ne: id } });
    if (existingCar) {
        const error = new Error('License plate already exists. Please use a different license plate number.');
        error.statusCode = 400;
        return next(error);
    }

    // Proceed with the update
    const updatedCar = await Car.findByIdAndUpdate(
        id, 
        { ...req.body },
        { new: true, runValidators: true }
    );

    if (!updatedCar) {
        const error = new Error('Car not found.');
        error.statusCode = 404;
        return next(error);
    }

    res.status(200).json({
        status: 'success',
        data: {
            car: updatedCar
        }
    });
});

exports.deleteCar = catchAsync(async (req, res) => {
    const { carId } = req.params;

    console.log('Attempting to delete car with ID:', carId); // Log the car ID

    // Find the car first to check if it exists
    const car = await Car.findById(carId);
    if (!car) {
        console.log('Car not found for ID:', carId); // Log if car is not found
        return res.status(404).json({
            status: 'fail',
            message: 'Car not found'
        });
    }

    // Start a transaction for safe deletion
    const session = await Car.startSession();
    try {
        await session.withTransaction(async () => {
            // 1. Find all routes associated with this car
            const routes = await Route.find({ carId });
            
            // 2. Get all routeIds to delete associated schedules
            const routeIds = routes.map(route => route._id);

            // 3. Delete all route schedules associated with these routes
            if (routeIds.length > 0) {
                await RouteSchedule.deleteMany({ 
                    routeId: { $in: routeIds } 
                });
            }

            // 4. Delete all routes associated with this car
            await Route.deleteMany({ carId });

            // 5. Finally delete the car
            await Car.findByIdAndDelete(carId);
        });

        await session.endSession();

        res.status(200).json({
            status: 'success',
            message: 'Car and all associated routes and schedules have been deleted'
        });

    } catch (error) {
        await session.endSession();
        throw error;
    }
});

exports.getAdminCars = catchAsync(async (req, res) => {
    const cars = await Car.find({ adminId: req.user.id });

    res.status(200).json({
        status: 'success',
        results: cars.length,
        data: {
            cars
        }
    });
});
