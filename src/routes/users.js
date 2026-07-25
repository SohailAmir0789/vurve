const { Router } = require('express');

const { followUser, unfollowUser, getUserPublicProfile, getUserVideos } = require('../controllers/userController');
const requireAuth = require('../middleware/requireAuth');

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/:handle', getUserPublicProfile);
router.get('/:handle/videos', getUserVideos);

// ── Protected ─────────────────────────────────────────────────────────────────
router.post  ('/:handle/follow', requireAuth, followUser);
router.delete('/:handle/follow', requireAuth, unfollowUser);

module.exports = router;
