/**
 * Central error-handling middleware.
 * Must be registered LAST in the Express middleware chain.
 *
 * Catches any error forwarded via next(err) and returns a clean JSON
 * response without leaking internal stack traces to the client.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Log the full error server-side for debugging
  console.error(`[error] ${req.method} ${req.url} →`, err);

  res.status(status).json({ error: message });
}

module.exports = errorHandler;
