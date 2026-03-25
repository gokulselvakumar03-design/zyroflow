const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const rulesController = require('../controllers/rulesController');

// only admin should manage rules, here we rely on role check by request body user object.
router.get('/', authMiddleware, rulesController.getRules);
router.post('/', authMiddleware, (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin role required' });
  }
  next();
}, rulesController.createRule);

module.exports = router;
