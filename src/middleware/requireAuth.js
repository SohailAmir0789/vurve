const jwt  = require('jsonwebtoken');

/**
 * Middleware: requireAuth
 *
 * Reads the `Authorization: Bearer <token>` header, verifies the JWT
 * against JWT_SECRET, and attaches { id, handle } to req.user.
 *
 * Returns 401 for any missing, malformed, or expired token — intentionally
 * no detail about which failure occurred so as not to aid enumeration.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, handle: payload.handle };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = requireAuth;
