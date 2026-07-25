const pool = require('./pool');

// ── User Queries ─────────────────────────────────────────────────────────────

/**
 * Find a user by email. Returns the full row including password_hash.
 * Used only by login — never returned to the client.
 */
async function findUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, handle, email, password_hash, display_name, bio, avatar_url, created_at
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

/**
 * Find a user by id. Returns the public fields (no password_hash).
 * Used by GET /auth/me.
 */
async function findUserById(id) {
  const { rows } = await pool.query(
    `SELECT id, handle, email, display_name, bio, avatar_url, created_at
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Insert a new user and return the public fields.
 * Callers must pass an already-hashed password.
 */
async function createUser({ handle, email, passwordHash, displayName }) {
  const { rows } = await pool.query(
    `INSERT INTO users (handle, email, password_hash, display_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, handle, email, display_name`,
    [handle, email, passwordHash, displayName || null],
  );
  return rows[0];
}

module.exports = { findUserByEmail, findUserById, createUser };
