const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/authMiddleware');
const draftController = require('../controllers/draftController');

// GET /api/drafts - Get all drafts for logged-in employee
router.get('/', optionalAuth, draftController.getDrafts);

// GET /api/drafts/:id - Get single draft by ID
router.get('/:id', optionalAuth, draftController.getDraftById);

// POST /api/drafts - Save/Create/Update draft
router.post('/', optionalAuth, draftController.saveDraft);

// DELETE /api/drafts/:id - Delete draft by ID
router.delete('/:id', optionalAuth, draftController.deleteDraft);
router.post('/:id/delete', optionalAuth, draftController.deleteDraft);

module.exports = router;
