const pool = require('../config/db');

function getSessionId(req) {
  if (!pool.isDemoMode) return null;
  return req?.demoSessionId || req?.user?.demo_session_id || 'default';
}

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
 */
exports.getDrafts = async (req, res, next) => {
  try {
    const employeeId = String(req.user?.employee_id || req.user?.email || req.user?.id || req.query.employee_id || req.query.email || '').toLowerCase().trim();
    const sessionId = getSessionId(req);

    if (!employeeId) {
      return res.status(200).json({ success: true, message: 'No employee ID provided', drafts: [] });
    }

    if (!pool) {
      return res.status(500).json({ success: false, message: 'Database connection unavailable', drafts: [] });
    }

    const sql = pool.isDemoMode && sessionId
      ? `SELECT id, employee_id, request_type, department, priority, payload, created_at, updated_at
         FROM draft_requests
         WHERE demo_session_id = ? AND (LOWER(employee_id) = LOWER(?) OR LOWER(employee_id) = LOWER(?))
         ORDER BY updated_at DESC`
      : `SELECT id, employee_id, request_type, department, priority, payload, created_at, updated_at
         FROM draft_requests
         WHERE LOWER(employee_id) = LOWER(?) OR LOWER(employee_id) = LOWER(?)
         ORDER BY updated_at DESC`;
    const params = pool.isDemoMode && sessionId
      ? [sessionId, employeeId, req.user?.email || employeeId]
      : [employeeId, req.user?.email || employeeId];

    const [rows] = await pool.query(sql, params);

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
 */
exports.getDraftById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sessionId = getSessionId(req);

    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Valid draft ID required' });
    }

    if (!pool) {
      return res.status(500).json({ success: false, message: 'Database connection unavailable' });
    }

    const sql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM draft_requests WHERE demo_session_id = ? AND id = ?'
      : 'SELECT * FROM draft_requests WHERE id = ?';
    const params = pool.isDemoMode && sessionId ? [sessionId, id] : [id];

    const [rows] = await pool.query(sql, params);
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
 */
exports.saveDraft = async (req, res, next) => {
  try {
    const { id, request_type, department, priority, payload } = req.body || {};
    const employeeId = String(req.user?.employee_id || req.user?.email || req.user?.id || req.body?.employee_id || '').toLowerCase().trim();
    const sessionId = getSessionId(req);

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
      const checkSql = pool.isDemoMode && sessionId
        ? 'SELECT id FROM draft_requests WHERE demo_session_id = ? AND id = ?'
        : 'SELECT id FROM draft_requests WHERE id = ?';
      const checkParams = pool.isDemoMode && sessionId ? [sessionId, draftId] : [draftId];

      const [existing] = await pool.query(checkSql, checkParams);
      if (existing && existing.length > 0) {
        const upSql = pool.isDemoMode && sessionId
          ? `UPDATE draft_requests
             SET request_type = ?, department = ?, priority = ?, payload = ?, updated_at = CURRENT_TIMESTAMP
             WHERE demo_session_id = ? AND id = ?`
          : `UPDATE draft_requests
             SET request_type = ?, department = ?, priority = ?, payload = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`;
        const upParams = pool.isDemoMode && sessionId
          ? [reqType, dept, prio, payloadJson, sessionId, draftId]
          : [reqType, dept, prio, payloadJson, draftId];
        await pool.query(upSql, upParams);
      } else {
        if (pool.isDemoMode && sessionId) {
          const [result] = await pool.query(
            `INSERT INTO draft_requests (demo_session_id, employee_id, request_type, department, priority, payload)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [sessionId, employeeId, reqType, dept, prio, payloadJson]
          );
          draftId = result.insertId;
        } else {
          const [result] = await pool.query(
            `INSERT INTO draft_requests (employee_id, request_type, department, priority, payload)
             VALUES (?, ?, ?, ?, ?)`,
            [employeeId, reqType, dept, prio, payloadJson]
          );
          draftId = result.insertId;
        }
      }
    } else {
      if (pool.isDemoMode && sessionId) {
        const [result] = await pool.query(
          `INSERT INTO draft_requests (demo_session_id, employee_id, request_type, department, priority, payload)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [sessionId, employeeId, reqType, dept, prio, payloadJson]
        );
        draftId = result.insertId;
      } else {
        const [result] = await pool.query(
          `INSERT INTO draft_requests (employee_id, request_type, department, priority, payload)
           VALUES (?, ?, ?, ?, ?)`,
          [employeeId, reqType, dept, prio, payloadJson]
        );
        draftId = result.insertId;
      }
    }

    const selectSql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM draft_requests WHERE demo_session_id = ? AND id = ?'
      : 'SELECT * FROM draft_requests WHERE id = ?';
    const selectParams = pool.isDemoMode && sessionId ? [sessionId, draftId] : [draftId];

    const [updatedRows] = await pool.query(selectSql, selectParams);
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
 */
exports.deleteDraft = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sessionId = getSessionId(req);

    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Valid draft ID required' });
    }

    if (!pool) {
      return res.status(500).json({ success: false, message: 'Unable to delete draft.' });
    }

    const sql = pool.isDemoMode && sessionId
      ? 'DELETE FROM draft_requests WHERE demo_session_id = ? AND id = ?'
      : 'DELETE FROM draft_requests WHERE id = ?';
    const params = pool.isDemoMode && sessionId ? [sessionId, id] : [id];

    await pool.query(sql, params);
    return res.status(200).json({ success: true, message: 'Draft deleted successfully.' });
  } catch (err) {
    console.error('[DraftController] deleteDraft error:', err.message);
    return res.status(500).json({ success: false, message: 'Unable to delete draft.' });
  }
};
