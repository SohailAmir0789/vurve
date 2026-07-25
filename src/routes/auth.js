const { Router } = require('express');

const { signup, login, me } = require('../controllers/authController');
const requireAuth            = require('../middleware/requireAuth');

const router = Router();

// Public routes
router.post('/signup', signup);
router.post('/login',  login);

// Protected routes
router.get('/me', requireAuth, me);

module.exports = router;
