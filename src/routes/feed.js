const { Router } = require('express');
const { getFeed } = require('../controllers/feedController');
const requireAuth = require('../middleware/requireAuth');

const router = Router();

router.get('/', requireAuth, getFeed);

module.exports = router;
