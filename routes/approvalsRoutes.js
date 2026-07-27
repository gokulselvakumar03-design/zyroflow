const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const approvalsController = require('../controllers/approvalsController');

router.get('/pending-approvals', authMiddleware, approvalsController.getPendingApprovals);
router.post('/approve', authMiddleware, approvalsController.approve);
router.post('/reject', authMiddleware, approvalsController.reject);
router.put('/requests/:id/approve', authMiddleware, approvalsController.approve);
router.put('/requests/:id/reject', authMiddleware, approvalsController.reject);
router.post('/requests/:id/approve', authMiddleware, approvalsController.approve);
router.post('/requests/:id/reject', authMiddleware, approvalsController.reject);

module.exports = router;
