const pool = require('../config/db');

function parseJsonValue(val, fallback = {}) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    return fallback;
  }
}

/**
 * GET /api/drafts
 * Retrieves all saved drafts for the logged-in employee
 */
exports.getDrafts = async (req, res, next) => {
  try {
    const employeeId = String(req.user?.employee_id || req.user?.email || req.user?.id || req.query.employee_id || req.query.email || '').toLowerCase().trim();

    if (!employeeId) {
      return res.status(200).json({ success: true, message: 'No employee ID provided', drafts: [] });
    }

    if (!pool) {
      return res.status(500).json({ success: false, message: 'Database connection unavailable', drafts: [] });
    }

    const [rows] = await pool.query(
      `SELECT id, employee_id, request_type, department, priority, payload, created_at, updated_at
       FROM draft_requests
       WHERE LOWER(employee_id) = LOWER(?) OR LOWER(employee_id) = LOWER(?)
       ORDER BY updated_at DESC`,
      [employeeId, req.user?.email || employeeId]
    );

    const drafts = (rows || []).map(r => ({
      id: Number(r.id),
      employee_id: r.employee_id,
      request_type: r.request_type || '',
      department: r.department || '',
      priority: r.priority || 'Medium',
      payload: parseJsonValue(r.payload, {}),
      created_at: r.created_at,
      updated_at: r.updated_at
    }));

    return res.status(200).json({ success: true, message: 'Drafts retrieved successfully', drafts });
  } catch (err) {
    console.error('[DraftController] getDrafts error:', err.message);
    return res.status(500).json({ success: false, message: 'Unable to fetch drafts.', drafts: [] });
  }
};

/**
 * GET /api/drafts/:id
 * Fetches a single draft by ID
 */
exports.getDraftById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Valid draft ID required' });
    }

    if (!pool) {
      return res.status(500).json({ success: false, message: 'Database connection unavailable' });
    }

    const [rows] = await pool.query('SELECT * FROM draft_requests WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    const r = rows[0];
    const draft = {
      id: Number(r.id),
      employee_id: r.employee_id,
      request_type: r.request_type || '',
      department: r.department || '',
      priority: r.priority || 'Medium',
      payload: parseJsonValue(r.payload, {}),
      created_at: r.created_at,
      updated_at: r.updated_at
    };

    return res.status(200).json({ success: true, message: 'Draft retrieved successfully', draft });
  } catch (err) {
    console.error('[DraftController] getDraftById error:', err.message);
    return res.status(500).json({ success: false, message: 'Unable to fetch draft.' });
  }
};

/**
 * POST /api/drafts
 * Saves a new draft or updates an existing draft (if id is provided)
 */
exports.saveDraft = async (req, res, next) => {
  try {
    const { id, request_type, department, priority, payload } = req.body || {};
    const employeeId = String(req.user?.employee_id || req.user?.email || req.user?.id || req.body?.employee_id || '').toLowerCase().trim();

    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Employee identification required' });
    }

    if (!pool) {
      return res.status(500).json({ success: false, message: 'Unable to save draft.' });
    }

    const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    const reqType = String(request_type || payload?.request_type || '').trim();
    const dept = String(department || payload?.department || '').trim();
    const prio = String(priority || payload?.priority || 'Medium').trim();

    let draftId = Number(id);

    if (draftId && Number.isInteger(draftId) && draftId > 0) {
      // Check if draft exists
      const [existing] = await pool.query('SELECT id FROM draft_requests WHERE id = ?', [draftId]);
      if (existing && existing.length > 0) {
        await pool.query(
          `UPDATE draft_requests
           SET request_type = ?, department = ?, priority = ?, payload = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [reqType, dept, prio, payloadJson, draftId]
        );
      } else {
        const [result] = await pool.query(
          `INSERT INTO draft_requests (employee_id, request_type, department, priority, payload)
           VALUES (?, ?, ?, ?, ?)`,
          [employeeId, reqType, dept, prio, payloadJson]
        );
        draftId = result.insertId;
      }
    } else {
      const [result] = await pool.query(
        `INSERT INTO draft_requests (employee_id, request_type, department, priority, payload)
         VALUES (?, ?, ?, ?, ?)`,
        [employeeId, reqType, dept, prio, payloadJson]
      );
      draftId = result.insertId;
    }

    const [updatedRows] = await pool.query('SELECT * FROM draft_requests WHERE id = ?', [draftId]);
    const updated = updatedRows[0] || {};

    return res.status(200).json({
      success: true,
      message: 'Draft saved successfully.',
      draft: {
        id: Number(updated.id || draftId),
        employee_id: updated.employee_id || employeeId,
        request_type: updated.request_type || reqType,
        department: updated.department || dept,
        priority: updated.priority || prio,
        payload: parseJsonValue(updated.payload, {}),
        created_at: updated.created_at,
        updated_at: updated.updated_at
      }
    });
  } catch (err) {
    console.error('[DraftController] saveDraft error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Unable to save draft.'
    });
  }
};

/**
 * DELETE /api/drafts/:id
 * Deletes a draft by ID
 */
exports.deleteDraft = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Valid draft ID required' });
    }

    if (!pool) {
      return res.status(500).json({ success: false, message: 'Unable to delete draft.' });
    }

    await pool.query('DELETE FROM draft_requests WHERE id = ?', [id]);
    return res.status(200).json({ success: true, message: 'Draft deleted successfully.' });
  } catch (err) {
    console.error('[DraftController] deleteDraft error:', err.message);
    return res.status(500).json({ success: false, message: 'Unable to delete draft.' });
  }
};
