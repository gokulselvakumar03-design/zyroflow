const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const trackController = require('../controllers/trackController');

router.get('/track/:requestId', authMiddleware, trackController.trackRequest);

module.exports = router;
