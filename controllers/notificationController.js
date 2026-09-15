const pool = require('../config/db');

function getSessionId(req) {
  if (!pool.isDemoMode) return null;
  return req?.demoSessionId || req?.user?.demo_session_id || 'default';
}

/**
 * GET /api/notifications
 * Fetches notifications for logged in user (or by role & email query params)
 */
exports.getNotifications = async (req, res, next) => {
  try {
    const userRole = (req.user?.role || req.query.role || '').toLowerCase().trim();
    const userEmail = (req.user?.email || req.query.email || req.query.user_email || '').toLowerCase().trim();
    const sessionId = getSessionId(req);

    let query = `
      SELECT id, user_role, user_email, request_id, title, message, type, is_read, created_at,
             is_read as read_status
      FROM notifications
      WHERE 1=1
    `;
    const params = [];

    if (pool.isDemoMode && sessionId) {
      query += ` AND demo_session_id = ?`;
      params.push(sessionId);
    }

    if (userRole === 'employee') {
      if (userEmail) {
        query += ` AND LOWER(user_email) = LOWER(?)`;
        params.push(userEmail);
      } else {
        query += ` AND 1=0`;
      }
    } else if (userEmail && userRole) {
      query += ` AND (LOWER(user_email) = LOWER(?) OR LOWER(user_role) = LOWER(?))`;
      params.push(userEmail, userRole);
    } else if (userEmail) {
      query += ` AND LOWER(user_email) = LOWER(?)`;
      params.push(userEmail);
    } else if (userRole) {
      query += ` AND LOWER(user_role) = LOWER(?)`;
      params.push(userRole);
    }

    query += ` ORDER BY id DESC LIMIT 100`;

    const [rows] = await pool.query(query, params);

    const formatted = rows.map(r => ({
      id: Number(r.id),
      user_role: r.user_role,
      user_email: r.user_email,
      request_id: r.request_id ? Number(r.request_id) : null,
      title: r.title,
      message: r.message,
      type: r.type || 'info',
      is_read: Number(r.is_read) === 1 || Boolean(r.is_read),
      read_status: Number(r.is_read) === 1 || Boolean(r.is_read),
      created_at: r.created_at
    }));

    const unread_count = formatted.filter(n => !n.is_read).length;

    res.json({
      success: true,
      notifications: formatted,
      unread_count
    });
  } catch (err) {
    console.error('[NotificationController] Error fetching notifications:', err.message);
    next(err);
  }
};

/**
 * PATCH /api/notifications/:id/read
 */
exports.markAsRead = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sessionId = getSessionId(req);

    if (!id || !Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Valid notification id required' });
    }

    const sql = pool.isDemoMode && sessionId
      ? 'UPDATE notifications SET is_read = 1 WHERE demo_session_id = ? AND id = ?'
      : 'UPDATE notifications SET is_read = 1 WHERE id = ?';
    const params = pool.isDemoMode && sessionId ? [sessionId, id] : [id];

    await pool.query(sql, params);

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (err) {
    console.error('[NotificationController] Error marking as read:', err.message);
    next(err);
  }
};

/**
 * PUT /api/notifications/read-all
 */
exports.markAllAsRead = async (req, res, next) => {
  try {
    const userRole = (req.user?.role || req.body?.role || req.query.role || '').toLowerCase().trim();
    const userEmail = (req.user?.email || req.body?.email || req.query.email || '').toLowerCase().trim();
    const sessionId = getSessionId(req);

    let query = `UPDATE notifications SET is_read = 1 WHERE 1=1`;
    const params = [];

    if (pool.isDemoMode && sessionId) {
      query += ` AND demo_session_id = ?`;
      params.push(sessionId);
    }

    if (userRole === 'employee') {
      if (userEmail) {
        query += ` AND LOWER(user_email) = LOWER(?)`;
        params.push(userEmail);
      } else {
        query += ` AND 1=0`;
      }
    } else if (userEmail && userRole) {
      query += ` AND (LOWER(user_email) = LOWER(?) OR LOWER(user_role) = LOWER(?))`;
      params.push(userEmail, userRole);
    } else if (userEmail) {
      query += ` AND LOWER(user_email) = LOWER(?)`;
      params.push(userEmail);
    } else if (userRole) {
      query += ` AND LOWER(user_role) = LOWER(?))`;
      params.push(userRole);
    }

    await pool.query(query, params);

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    console.error('[NotificationController] Error marking all read:', err.message);
    next(err);
  }
};

/**
 * DELETE /api/notifications/:id
 */
exports.deleteNotification = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sessionId = getSessionId(req);

    if (!id || !Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Valid notification id required' });
    }

    const sql = pool.isDemoMode && sessionId
      ? 'DELETE FROM notifications WHERE demo_session_id = ? AND id = ?'
      : 'DELETE FROM notifications WHERE id = ?';
    const params = pool.isDemoMode && sessionId ? [sessionId, id] : [id];

    await pool.query(sql, params);

    res.json({ success: true, message: 'Notification deleted successfully' });
  } catch (err) {
    console.error('[NotificationController] Error deleting notification:', err.message);
    next(err);
  }
};
