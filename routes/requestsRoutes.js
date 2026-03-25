const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const requestsController = require('../controllers/requestsController');

router.post('/', authMiddleware, requestsController.createRequest);

module.exports = router;
