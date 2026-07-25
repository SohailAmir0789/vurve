const pool = require('../db/pool');

/**
 * GET /health
 * Runs a lightweight query against the DB.
 * Returns { status: "ok", db: "connected" } on success,
 * or 500 with the error message if the DB is unreachable.
 */
async function healthCheck(req, res, next) {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    next(err);
  }
}

module.exports = { healthCheck };
