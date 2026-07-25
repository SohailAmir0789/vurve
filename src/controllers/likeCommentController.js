const { validate: uuidValidate } = require('uuid');

const {
  insertLike,
  deleteLike,
  insertComment,
  getCommentsByVideo,
} = require('../db/socialQueries');

// ── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Verify a video id param looks like a uuid before hitting the DB.
 * Returns false and sends a 400 if invalid.
 */
function assertVideoId(id, res) {
  if (!id || !uuidValidate(id)) {
    res.status(400).json({ error: 'Video id must be a valid UUID' });
    return false;
  }
  return true;
}

// ── Like Controllers ──────────────────────────────────────────────────────────

/**
 * POST /videos/:id/like  (protected)
 *
 * Idempotent: liking an already-liked video returns 200, not an error.
 * like_count is maintained by a Postgres trigger — do not touch it here.
 */
async function likeVideo(req, res, next) {
  try {
    if (!assertVideoId(req.params.id, res)) return;

    await insertLike(req.user.id, req.params.id);

    // 200 whether inserted fresh or already existed
    return res.json({ liked: true });
  } catch (err) {
    // 23503 = foreign_key_violation: video doesn't exist
    if (err.code === '23503') {
      return res.status(404).json({ error: 'Video not found' });
    }
    next(err);
  }
}

/**
 * DELETE /videos/:id/like  (protected)
 *
 * Idempotent: 204 whether the row existed or not.
 */
async function unlikeVideo(req, res, next) {
  try {
    if (!assertVideoId(req.params.id, res)) return;

    await deleteLike(req.user.id, req.params.id);

    return res.sendStatus(204);
  } catch (err) {
    next(err);
  }
}

// ── Comment Controllers ───────────────────────────────────────────────────────

/**
 * POST /videos/:id/comments  (protected)
 * Body: { body }
 */
async function createComment(req, res, next) {
  try {
    if (!assertVideoId(req.params.id, res)) return;

    const body = (req.body.body || '').trim();

    if (!body) {
      return res.status(400).json({ error: 'Comment body cannot be blank' });
    }
    if (body.length > 500) {
      return res.status(400).json({ error: 'Comment body must be 500 characters or fewer' });
    }

    const comment = await insertComment(req.params.id, req.user.id, body);

    return res.status(201).json(comment);
  } catch (err) {
    if (err.code === '23503') {
      return res.status(404).json({ error: 'Video not found' });
    }
    next(err);
  }
}

/**
 * GET /videos/:id/comments  (public)
 * Query params: limit (default 20, max 100), before (ISO timestamp cursor)
 */
async function listComments(req, res, next) {
  try {
    if (!assertVideoId(req.params.id, res)) return;

    const { limit, before } = req.query;

    const { comments, nextCursor } = await getCommentsByVideo(req.params.id, { limit, before });

    return res.json({ comments, nextCursor });
  } catch (err) {
    next(err);
  }
}

module.exports = { likeVideo, unlikeVideo, createComment, listComments };
