const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/authMiddleware');
const approvalsController = require('../controllers/approvalsController');

router.get('/pending-approvals', optionalAuth, approvalsController.getPendingApprovals);
router.post('/approve', optionalAuth, approvalsController.approve);
router.post('/reject', optionalAuth, approvalsController.reject);
router.post('/escalate', optionalAuth, approvalsController.escalate);
router.put('/requests/:id/approve', optionalAuth, approvalsController.approve);
router.put('/requests/:id/reject', optionalAuth, approvalsController.reject);
router.put('/requests/:id/escalate', optionalAuth, approvalsController.escalate);
router.post('/requests/:id/approve', optionalAuth, approvalsController.approve);
router.post('/requests/:id/reject', optionalAuth, approvalsController.reject);
router.post('/requests/:id/escalate', optionalAuth, approvalsController.escalate);

module.exports = router;
