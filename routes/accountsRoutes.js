// Accounts Routes
// Handles routing for Accounts team endpoints

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const accountsController = require('../controllers/accountsController');

// GET /accounts/requests - Fetch financial requests assigned to Accounts
router.get('/requests', authMiddleware, accountsController.getAccountsRequests);

// Payment Verification
router.get('/payment-verification', authMiddleware, accountsController.getPaymentVerification);
router.post('/payment-verification', authMiddleware, accountsController.createPaymentVerification);

// Budget Analysis
router.get('/budget-analysis', authMiddleware, accountsController.getBudgetAnalysis);

// Financial Alerts
router.get('/financial-alerts', authMiddleware, accountsController.getFinancialAlerts);

// Analytics Charts
router.get('/charts', authMiddleware, accountsController.getAnalyticsCharts);

// Export Financial Report Data
router.get('/export', authMiddleware, accountsController.getExportData);

// Notifications
router.get('/notifications', authMiddleware, accountsController.getNotifications);
router.put('/notifications/:id/read', authMiddleware, accountsController.markNotificationRead);

module.exports = router;
