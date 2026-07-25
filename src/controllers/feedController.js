const pool = require('../db/pool');

/**
 * GET /feed  (protected)
 *
 * Fan-out-on-read: query follows JOIN videos at request time.
 *
 * Query params:
 *   limit  (number, default 20, max 100)
 *   before (ISO timestamp — created_at of the last item from the previous page)
 */
async function getFeed(req, res, next) {
  try {
    const userId = req.user.id;
    const limit  = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 20), 100);
    const before = req.query.before;

    let beforeData = null;
    if (before) {
      try {
        const decoded = Buffer.from(before, 'base64').toString('utf-8');
        beforeData = JSON.parse(decoded);
      } catch (e) {
        // invalid cursor
      }
    }

    let queryText = `
      SELECT v.id, v.user_id, v.caption, COALESCE(v.cdn_url, CONCAT('http://localhost:4000/videos/dev-upload/', v.id)) AS cdn_url,
             v.thumbnail_url, v.duration_ms,
             v.like_count, v.comment_count, v.view_count, v.created_at,
             u.handle, u.avatar_url, u.display_name,
             (l.user_id IS NOT NULL) AS is_liked
      FROM videos v
      JOIN users u ON v.user_id = u.id
      LEFT JOIN follows f ON f.followee_id = v.user_id AND f.follower_id = $1
      LEFT JOIN likes l ON l.video_id = v.id AND l.user_id = $1
      WHERE v.status IN ('ready', 'processing')
    `;
    const params = [userId];

    if (beforeData && beforeData.created_at && beforeData.id) {
      queryText += ` AND (v.created_at, v.id) < ($2, $3)`;
      params.push(beforeData.created_at, beforeData.id);
    }

    // Fetch limit + 1 to detect whether there is a next page
    queryText += ` ORDER BY v.created_at DESC, v.id DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const { rows } = await pool.query(queryText, params);

    let nextCursor = null;
    const hasMore = rows.length > limit;
    if (hasMore) {
      // The cursor encodes created_at and id of the last item we actually return
      const lastItem = rows[limit - 1];
      const cursorObj = {
        created_at: lastItem.created_at.toISOString(),
        id: lastItem.id
      };
      nextCursor = Buffer.from(JSON.stringify(cursorObj)).toString('base64');
      rows.splice(limit);
    }

    const videos = rows.map(r => ({
      id: r.id,
      user_id: r.user_id,
      caption: r.caption,
      cdn_url: r.cdn_url,
      thumbnail_url: r.thumbnail_url,
      duration_ms: r.duration_ms,
      like_count: parseInt(r.like_count, 10) || 0,
      comment_count: parseInt(r.comment_count, 10) || 0,
      view_count: parseInt(r.view_count, 10) || 0,
      created_at: r.created_at,
      handle: r.handle,
      avatar_url: r.avatar_url,
      display_name: r.display_name,
      is_liked: !!r.is_liked
    }));

    return res.json({ videos, nextCursor });
  } catch (err) {
    next(err);
  }
}

module.exports = { getFeed };
