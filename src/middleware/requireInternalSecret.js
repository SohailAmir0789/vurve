/**
 * Middleware: requireInternalSecret
 *
 * Guards internal-only endpoints (e.g. called by the transcoding worker)
 * using a shared secret in the X-Internal-Secret header.
 *
 * This intentionally does NOT use JWT so that machine-to-machine calls
 * don't need a user context. The secret lives in INTERNAL_WORKER_SECRET env.
 *
 * Returns 401 if the header is missing or wrong.
 */
function requireInternalSecret(req, res, next) {
  const secret = process.env.INTERNAL_WORKER_SECRET;
  const provided = req.headers['x-internal-secret'];

  if (!secret || !provided || provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = requireInternalSecret;
