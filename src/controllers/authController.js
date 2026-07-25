const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');

const { createUser, findUserByEmail, findUserById } = require('../db/userQueries');

// ── Constants ─────────────────────────────────────────────────────────────────

const BCRYPT_COST   = 12;
const JWT_EXPIRY    = '7d';

// Must match the DB constraint: 2-30 chars, only a-z A-Z 0-9 _ .
const HANDLE_REGEX  = /^[a-zA-Z0-9_.]{2,30}$/;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Detect a Postgres unique_violation (23505) and derive a user-friendly
 * message from which constraint was violated.
 */
function uniqueViolationMessage(err) {
  if (err.code !== '23505') return null;
  if (err.constraint && err.constraint.includes('handle')) {
    return 'That handle is already taken';
  }
  if (err.constraint && err.constraint.includes('email')) {
    return 'An account with that email already exists';
  }
  return 'Account already exists';
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, handle: user.handle },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRY },
  );
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * POST /auth/signup
 * Body: { handle, email, password, display_name? }
 */
async function signup(req, res, next) {
  try {
    const { handle, email, password, display_name: displayName } = req.body;

    // ── Validation ──────────────────────────────────────────────────────────
    const errors = [];

    if (!handle || !HANDLE_REGEX.test(handle)) {
      errors.push('handle must be 2-30 characters and contain only letters, numbers, underscores, or dots');
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('A valid email is required');
    }
    if (!password || password.length < 8) {
      errors.push('Password must be at least 8 characters');
    }

    if (errors.length) {
      return res.status(400).json({ error: errors.join('. ') });
    }

    // ── Hash & Insert ────────────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    const user = await createUser({ handle, email, passwordHash, displayName });

    return res.status(201).json({
      id:           user.id,
      handle:       user.handle,
      email:        user.email,
      display_name: user.display_name,
    });
  } catch (err) {
    const msg = uniqueViolationMessage(err);
    if (msg) return res.status(409).json({ error: msg });
    next(err);
  }
}

/**
 * POST /auth/login
 * Body: { email, password }
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await findUserByEmail(email);

    // Run bcrypt.compare even when user is null to prevent timing attacks
    // (using a dummy hash that will always fail).
    const DUMMY_HASH = '$2b$12$invalidhashpaddingthatwillnevermatchwhatever00000000000';
    const passwordMatch = await bcrypt.compare(
      password,
      user ? user.password_hash : DUMMY_HASH,
    );

    if (!user || !passwordMatch) {
      // Deliberately vague — don't reveal whether the email or password was wrong
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);

    return res.json({
      token,
      user: {
        id:           user.id,
        handle:       user.handle,
        email:        user.email,
        display_name: user.display_name,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /auth/me  (protected — requires requireAuth middleware)
 * Returns the authenticated user's public profile row.
 */
async function me(req, res, next) {
  try {
    const user = await findUserById(req.user.id);

    if (!user) {
      // Token was valid but the account was deleted after issuance
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(user);
  } catch (err) {
    next(err);
  }
}

module.exports = { signup, login, me };
