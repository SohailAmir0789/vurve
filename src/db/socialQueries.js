const pool = require('./pool');

// ── Like Queries ──────────────────────────────────────────────────────────────

/**
 * Insert a like. Returns true if inserted, false if it already existed.
 * Uses ON CONFLICT DO NOTHING so the caller never sees a constraint error.
 */
async function insertLike(userId, videoId) {
  const { rowCount } = await pool.query(
    `INSERT INTO likes (user_id, video_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, video_id) DO NOTHING`,
    [userId, videoId],
  );
  return rowCount > 0;
}

/**
 * Delete a like. Silently succeeds even if the row didn't exist.
 */
async function deleteLike(userId, videoId) {
  await pool.query(
    `DELETE FROM likes WHERE user_id = $1 AND video_id = $2`,
    [userId, videoId],
  );
}

// ── Comment Queries ───────────────────────────────────────────────────────────

/**
 * Insert a comment and return the full row joined with the commenter's profile.
 */
async function insertComment(videoId, userId, body) {
  const { rows } = await pool.query(
    `INSERT INTO comments (video_id, user_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, video_id, user_id, body, created_at`,
    [videoId, userId, body],
  );
  // Fetch enriched row with commenter info
  const { rows: enriched } = await pool.query(
    `SELECT c.id, c.video_id, c.body, c.created_at,
            u.handle, u.display_name, u.avatar_url
     FROM comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.id = $1`,
    [rows[0].id],
  );
  return enriched[0];
}

/**
 * Cursor-paginated comments for a video, newest first.
 * `before` is an ISO timestamp — returns comments created before that point.
 * Default limit is 20, max 100.
 */
async function getCommentsByVideo(videoId, { before, limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
  const params = [videoId];

  let queryText = `
    SELECT c.id, c.video_id, c.body, c.created_at,
           u.handle, u.display_name, u.avatar_url
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.video_id = $1
  `;

  let beforeData = null;
  if (before) {
    try {
      const decoded = Buffer.from(before, 'base64').toString('utf-8');
      beforeData = JSON.parse(decoded);
    } catch (e) {
      beforeData = { created_at: before };
    }
  }

  if (beforeData && beforeData.created_at) {
    if (beforeData.id) {
      queryText += ` AND (c.created_at, c.id) < ($2, $3)`;
      params.push(beforeData.created_at, beforeData.id);
    } else {
      queryText += ` AND c.created_at < $2`;
      params.push(beforeData.created_at);
    }
  }

  queryText += ` ORDER BY c.created_at DESC, c.id DESC LIMIT $${params.length + 1}`;
  params.push(safeLimit + 1);

  const { rows } = await pool.query(queryText, params);

  let nextCursor = null;
  const hasMore = rows.length > safeLimit;
  if (hasMore) {
    const lastItem = rows[safeLimit - 1];
    const cursorObj = {
      created_at: lastItem.created_at.toISOString(),
      id: lastItem.id
    };
    nextCursor = Buffer.from(JSON.stringify(cursorObj)).toString('base64');
    rows.splice(safeLimit);
  }

  return { comments: rows, nextCursor };
}

// ── Follow Queries ────────────────────────────────────────────────────────────

/**
 * Resolve a handle to a user id. Returns the user row or null.
 */
async function findUserByHandle(handle) {
  const { rows } = await pool.query(
    `SELECT id, handle, display_name, bio, avatar_url
     FROM users
     WHERE handle = $1
     LIMIT 1`,
    [handle],
  );
  return rows[0] || null;
}

/**
 * Insert a follow relationship. Idempotent via ON CONFLICT DO NOTHING.
 */
async function insertFollow(followerId, followingId) {
  const { rowCount } = await pool.query(
    `INSERT INTO follows (follower_id, followee_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [followerId, followingId],
  );
  return rowCount > 0;
}

/**
 * Delete a follow relationship. Silently succeeds if not present.
 */
async function deleteFollow(followerId, followingId) {
  await pool.query(
    `DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`,
    [followerId, followingId],
  );
}

// ── Profile Query ─────────────────────────────────────────────────────────────

/**
 * Public profile: handle, display_name, bio, avatar_url plus computed counts
 * for followers, following, and videos — no denormalized columns needed.
 */
async function getUserProfile(handle, viewerUserId = null) {
  const { rows } = await pool.query(
    `SELECT u.id,
            u.handle,
            u.display_name,
            u.bio,
            u.avatar_url,
            COUNT(DISTINCT f_in.follower_id)   AS follower_count,
            COUNT(DISTINCT f_out.followee_id) AS following_count,
            COUNT(DISTINCT v.id)               AS video_count,
            EXISTS(
              SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = u.id
            ) AS is_following
     FROM users u
     LEFT JOIN follows f_in  ON f_in.followee_id = u.id
     LEFT JOIN follows f_out ON f_out.follower_id  = u.id
     LEFT JOIN videos  v     ON v.user_id          = u.id AND v.status IN ('ready', 'processing')
     WHERE u.handle = $1
     GROUP BY u.id, u.handle, u.display_name, u.bio, u.avatar_url`,
    [handle, viewerUserId],
  );
  return rows[0] || null;
}

/**
 * Fetch a user's uploaded videos with cursor pagination.
 */
async function getUserVideosByHandle(handle, { limit = 20, before } = {}) {
  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
  const params = [handle];

  let queryText = `
    SELECT v.id, v.user_id, v.caption, COALESCE(v.cdn_url, CONCAT('http://localhost:4000/videos/dev-upload/', v.id)) AS cdn_url,
           v.thumbnail_url, v.duration_ms,
           v.like_count, v.comment_count, v.view_count, v.created_at,
           u.handle, u.avatar_url, u.display_name
    FROM videos v
    JOIN users u ON u.id = v.user_id
    WHERE u.handle = $1 AND v.status IN ('ready', 'processing')
  `;

  let beforeData = null;
  if (before) {
    try {
      const decoded = Buffer.from(before, 'base64').toString('utf-8');
      beforeData = JSON.parse(decoded);
    } catch (e) {
      beforeData = { created_at: before };
    }
  }

  if (beforeData && beforeData.created_at) {
    if (beforeData.id) {
      queryText += ` AND (v.created_at, v.id) < ($2, $3)`;
      params.push(beforeData.created_at, beforeData.id);
    } else {
      queryText += ` AND v.created_at < $2`;
      params.push(beforeData.created_at);
    }
  }

  queryText += ` ORDER BY v.created_at DESC, v.id DESC LIMIT $${params.length + 1}`;
  params.push(safeLimit + 1);

  const { rows } = await pool.query(queryText, params);

  let nextCursor = null;
  const hasMore = rows.length > safeLimit;
  if (hasMore) {
    const lastItem = rows[safeLimit - 1];
    const cursorObj = {
      created_at: lastItem.created_at.toISOString(),
      id: lastItem.id
    };
    nextCursor = Buffer.from(JSON.stringify(cursorObj)).toString('base64');
    rows.splice(safeLimit);
  }

  return { videos: rows, nextCursor };
}

module.exports = {
  insertLike,
  deleteLike,
  insertComment,
  getCommentsByVideo,
  findUserByHandle,
  insertFollow,
  deleteFollow,
  getUserProfile,
  getUserVideosByHandle,
};
