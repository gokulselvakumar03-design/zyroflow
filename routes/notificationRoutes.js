const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/authMiddleware');
const notificationController = require('../controllers/notificationController');

router.get('/', optionalAuth, notificationController.getNotifications);
router.patch('/:id/read', optionalAuth, notificationController.markAsRead);
router.put('/:id/read', optionalAuth, notificationController.markAsRead);
router.post('/:id/read', optionalAuth, notificationController.markAsRead);
router.put('/read-all', optionalAuth, notificationController.markAllAsRead);
router.post('/read-all', optionalAuth, notificationController.markAllAsRead);
router.delete('/:id', optionalAuth, notificationController.deleteNotification);
router.post('/:id/delete', optionalAuth, notificationController.deleteNotification);

module.exports = router;
