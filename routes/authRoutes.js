const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/login', authController.login);
router.post('/users', authController.createUser);
router.get('/users', authController.getUsers);
router.put('/users/:id', authController.updateUser);
router.patch('/users/:id/activate', authController.activateUser);
router.patch('/users/:id/deactivate', authController.deactivateUser);

module.exports = router;
