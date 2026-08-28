const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const { optionalAuth } = require('../middleware/authMiddleware');

router.post('/login', authController.login);
router.get('/verify', authMiddleware, authController.verifyToken);
router.post('/recovery-email', authController.saveRecoveryEmail);
router.post('/save-recovery-email', authController.saveRecoveryEmail);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/users', authController.createUser);
router.get('/users', authController.getUsers);
router.put('/users/:id', authController.updateUser);
router.patch('/users/:id/activate', authController.activateUser);
router.patch('/users/:id/deactivate', authController.deactivateUser);

module.exports = router;
