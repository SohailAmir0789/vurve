const express = require('express');
const { Router } = express;

const { getUploadUrl, createVideoRecord, updateStatus, handleDevUpload, serveDevVideo } = require('../controllers/videoController');
const { likeVideo, unlikeVideo, createComment, listComments } = require('../controllers/likeCommentController');
const requireAuth           = require('../middleware/requireAuth');
const requireInternalSecret = require('../middleware/requireInternalSecret');

const router = Router();

// ── Upload (JWT protected) ────────────────────────────────────────────────────
router.post('/upload-url', requireAuth, getUploadUrl);
router.put('/dev-upload/:videoId', express.raw({ type: '*/*', limit: '100mb' }), handleDevUpload);
router.get('/dev-upload/:videoId', serveDevVideo);
router.post('/',           requireAuth, createVideoRecord);

// ── Likes (JWT protected) ─────────────────────────────────────────────────────
router.post  ('/:id/like', requireAuth, likeVideo);
router.delete('/:id/like', requireAuth, unlikeVideo);

// ── Comments ──────────────────────────────────────────────────────────────────
router.post('/:id/comments', requireAuth, createComment);  // protected
router.get ('/:id/comments',              listComments);   // public

// ── Internal (shared-secret protected) ───────────────────────────────────────
router.patch('/:id/status', requireInternalSecret, updateStatus);

module.exports = router;
