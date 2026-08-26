const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const rulesController = require('../controllers/rulesController');

// Get rules (open or authenticated)
router.get('/', rulesController.getRules);
router.post('/', rulesController.createRule);
router.delete('/:id', rulesController.deleteRule);

module.exports = router;
