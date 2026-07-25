const jwt = require('jsonwebtoken');
const {
  findUserByHandle,
  insertFollow,
  deleteFollow,
  getUserProfile,
  getUserVideosByHandle,
} = require('../db/socialQueries');

function getOptionalUserId(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.sub || payload.id;
  } catch (err) {
    return null;
  }
}

// ── Follow Controllers ────────────────────────────────────────────────────────

/**
 * POST /users/:handle/follow  (protected)
 *
 * Looks up the target by handle, rejects self-follows, then inserts
 * idempotently via ON CONFLICT DO NOTHING.
 */
async function followUser(req, res, next) {
  try {
    const target = await findUserByHandle(req.params.handle);

    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot follow yourself' });
    }

    await insertFollow(req.user.id, target.id);

    // 200 whether inserted fresh or already existed
    return res.json({ following: true });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /users/:handle/follow  (protected)
 *
 * Idempotent: 204 whether the row existed or not.
 */
async function unfollowUser(req, res, next) {
  try {
    const target = await findUserByHandle(req.params.handle);

    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    await deleteFollow(req.user.id, target.id);

    return res.sendStatus(204);
  } catch (err) {
    next(err);
  }
}

// ── Profile Controller ────────────────────────────────────────────────────────

/**
 * GET /users/:handle  (public)
 *
 * Returns handle, display_name, bio, avatar_url, live-computed counts
 * for followers, following, and videos, plus is_following boolean if authenticated.
 */
async function getUserPublicProfile(req, res, next) {
  try {
    const viewerUserId = getOptionalUserId(req);
    const profile = await getUserProfile(req.params.handle, viewerUserId);

    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      handle:          profile.handle,
      display_name:    profile.display_name,
      bio:             profile.bio,
      avatar_url:      profile.avatar_url,
      follower_count:  parseInt(profile.follower_count,  10) || 0,
      following_count: parseInt(profile.following_count, 10) || 0,
      video_count:     parseInt(profile.video_count,     10) || 0,
      is_following:    !!profile.is_following,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /users/:handle/videos  (public)
 */
async function getUserVideos(req, res, next) {
  try {
    const { handle } = req.params;
    const { limit, before } = req.query;

    const result = await getUserVideosByHandle(handle, { limit, before });
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { followUser, unfollowUser, getUserPublicProfile, getUserVideos };
