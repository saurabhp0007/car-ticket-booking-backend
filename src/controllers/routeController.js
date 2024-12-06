const Route = require('../models/Route');
const catchAsync = require('../utils/catchAsync');
const Openrouteservice = require('openrouteservice-js');

const orsDirections = new Openrouteservice.Directions({
    api_key: process.env.OPENROUTE_API_KEY
});

const orsGeocoding = new Openrouteservice.Geocode({
    api_key: process.env.OPENROUTE_API_KEY
});

exports.createRoute = catchAsync(async (req, res) => {
    const {
        name,
        carId,
        startLocation,
        endLocation,
        waypoints,
        schedule
    } = req.body;

    const route = await Route.create({
        name,
        carId,
        adminId: req.user.id,
        startLocation,
        endLocation,
        waypoints,
        schedule
    });

    res.status(201).json({
        status: 'success',
        data: { route }
    });
});

exports.getCarRoutes = catchAsync(async (req, res) => {
    const routes = await Route.find({ 
        carId: req.params.carId,
        adminId: req.user.id 
    });

    res.status(200).json({
        status: 'success',
        results: routes.length,
        data: { routes }
    });
});

exports.updateRoute = catchAsync(async (req, res) => {
    const route = await Route.findOneAndUpdate(
        { 
            _id: req.params.routeId,
            adminId: req.user.id 
        },
        req.body,
        { new: true, runValidators: true }
    );

    if (!route) {
        return res.status(404).json({
            status: 'fail',
            message: 'Route not found or you are not authorized'
        });
    }

    res.status(200).json({
        status: 'success',
        data: { route }
    });
});

exports.deleteRoute = catchAsync(async (req, res) => {
    const route = await Route.findOneAndDelete({
        _id: req.params.routeId,
        adminId: req.user.id
    });

    if (!route) {
        return res.status(404).json({
            status: 'fail',
            message: 'Route not found or you are not authorized'
        });
    }

    res.status(204).json({
        status: 'success',
        data: null
    });
});

exports.getRouteDistance = catchAsync(async (req, res) => {
    console.log('Starting route distance calculation...');
    
    const route = await Route.findOne({
        _id: req.params.routeId,
        adminId: req.user.id
    });

    if (!route) {
        console.log('Route not found or unauthorized:', { routeId: req.params.routeId, userId: req.user.id });
        return res.status(404).json({
            status: 'fail',
            message: 'Route not found or you are not authorized'
        });
    }

    console.log('Found route:', { 
        startAddress: route.startLocation.address, 
        endAddress: route.endLocation.address 
    });

    try {
        // Geocode start location with proper object format
        console.log('Geocoding start location:', route.startLocation.address);
        const startGeocode = await orsGeocoding.geocode({
            text: route.startLocation.address
        });
        
        // Geocode end location with proper object format
        console.log('Geocoding end location:', route.endLocation.address);
        const endGeocode = await orsGeocoding.geocode({
            text: route.endLocation.address
        });

        // Check if geocoding results are valid
        if (!startGeocode.features.length || !endGeocode.features.length) {
            console.error('Location not found:', {
                startLocationFound: startGeocode.features.length > 0,
                endLocationFound: endGeocode.features.length > 0
            });
            return res.status(400).json({
                status: 'fail',
                message: 'Could not find one or both locations. Please check the spelling.'
            });
        }

        // Extract coordinates from geocoding results
        const startCoords = startGeocode.features[0].geometry.coordinates;
        const endCoords = endGeocode.features[0].geometry.coordinates;

        console.log('Coordinates extracted:', {
            start: startCoords,
            end: endCoords
        });

        const coordinates = [startCoords, endCoords];

        console.log('Calculating route...');
        const routeData = await orsDirections.calculate({
            coordinates: coordinates,
            profile: 'driving-car',
            format: 'json'
        });

        const distanceInKm = routeData.routes[0].summary.distance / 1000;

        console.log('Route calculation successful:', {
            distanceKm: distanceInKm.toFixed(2),
            durationSeconds: routeData.routes[0].summary.duration
        });

        res.status(200).json({
            status: 'success',
            data: {
                distance: {
                    kilometers: distanceInKm.toFixed(2),
                    meters: routeData.routes[0].summary.distance
                },
                duration: routeData.routes[0].summary.duration
            }
        });
    } catch (error) {
        console.error('Operation failed:', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
});