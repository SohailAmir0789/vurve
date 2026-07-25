const pool = require('./pool');

// ── Video Queries ─────────────────────────────────────────────────────────────

/**
 * Insert a new video row with status='processing'.
 * cdn_url, thumbnail_url, duration_ms intentionally left NULL until the
 * transcoding worker calls the status-update endpoint.
 */
async function createVideo({ id, userId, caption }) {
  const { rows } = await pool.query(
    `INSERT INTO videos (id, user_id, caption, status)
     VALUES ($1, $2, $3, 'processing')
     RETURNING id, user_id, caption, status, cdn_url, thumbnail_url,
               duration_ms, like_count, comment_count, view_count, created_at`,
    [id, userId, caption || null],
  );
  return rows[0];
}

/**
 * Find a video by (id, userId).
 * Used to detect duplicate inserts before attempting a conflicting INSERT.
 */
async function findVideoByIdAndUser(id, userId) {
  const { rows } = await pool.query(
    `SELECT id FROM videos WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, userId],
  );
  return rows[0] || null;
}

/**
 * Update a video's processing status and optional metadata fields.
 * Only the columns explicitly provided are written (others stay untouched).
 *
 * Returns the updated row, or null if no row was found.
 */
async function updateVideoStatus(id, { status, cdnUrl, thumbnailUrl, durationMs }) {
  const { rows } = await pool.query(
    `UPDATE videos
     SET status        = $2,
         cdn_url       = COALESCE($3, cdn_url),
         thumbnail_url = COALESCE($4, thumbnail_url),
         duration_ms   = COALESCE($5, duration_ms),
         updated_at    = now()
     WHERE id = $1
     RETURNING id, user_id, caption, status, cdn_url, thumbnail_url,
               duration_ms, like_count, comment_count, view_count,
               created_at, updated_at`,
    [id, status, cdnUrl ?? null, thumbnailUrl ?? null, durationMs ?? null],
  );
  return rows[0] || null;
}

/**
 * Atomically claim a video for transcoding.
 * Switches status from 'processing' to 'transcoding'.
 * Returns the row if successful, otherwise null (already claimed).
 */
async function claimVideoForTranscoding(id) {
  const { rows } = await pool.query(
    `UPDATE videos
     SET status = 'transcoding', updated_at = now()
     WHERE id = $1 AND status = 'processing'
     RETURNING id, user_id, caption, status, cdn_url, thumbnail_url,
               duration_ms, like_count, comment_count, view_count,
               created_at, updated_at`,
    [id],
  );
  return rows[0] || null;
}

module.exports = { createVideo, findVideoByIdAndUser, updateVideoStatus, claimVideoForTranscoding };
