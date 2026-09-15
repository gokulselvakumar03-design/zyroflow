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
router.get('/next-employee-id', authController.getNextEmployeeId);
router.put('/users/:id', authController.updateUser);
router.patch('/users/:id/activate', authController.activateUser);
router.patch('/users/:id/deactivate', authController.deactivateUser);

// Temporary Demo Access Management (Admin only)
router.post('/demo-access/generate', authMiddleware, authController.generateDemoAccess);
router.get('/demo-access/list', authMiddleware, authController.getDemoAccessList);

module.exports = router;
