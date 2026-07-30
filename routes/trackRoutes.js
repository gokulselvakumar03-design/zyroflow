const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/authMiddleware');
const trackController = require('../controllers/trackController');

router.get('/track/:requestId', optionalAuth, trackController.trackRequest);

module.exports = router;
