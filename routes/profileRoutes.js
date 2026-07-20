const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/profile', authMiddleware, profileController.getProfile);
router.put('/profile', authMiddleware, profileController.updateProfile);
router.post('/change-password', authMiddleware, profileController.changePassword);

module.exports = router;
