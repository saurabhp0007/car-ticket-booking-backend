/**
 * Wraps an async function and catches any errors, passing them to next()
 * This eliminates the need for try-catch blocks in async controllers
 */
const catchAsync = fn => {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
};

module.exports = catchAsync; 