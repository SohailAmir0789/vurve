const { Router } = require('express');
const { healthCheck } = require('../controllers/healthController');

const router = Router();

router.get('/health', healthCheck);

module.exports = router;
