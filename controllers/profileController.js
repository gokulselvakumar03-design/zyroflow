const pool = require('../config/db');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const { validatePassword } = require('../utils/passwordValidator');

dotenv.config();

function getSessionId(req) {
  if (!pool.isDemoMode) return null;
  return req?.demoSessionId || req?.user?.demo_session_id || 'default';
}

function getAuthenticatedUser(req) {
  const user = req?.user || {};
  const userId = user.id != null ? String(user.id) : '';
  const email = String(user.email || '').trim();

  if (userId || email) {
    return { userId, email };
  }

  return null;
}

exports.getProfile = async (req, res, next) => {
  try {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) return res.status(401).json({ message: 'Authentication required' });

    const { userId, email } = authUser;
    const sessionId = getSessionId(req);

    let sql;
    let params;

    if (pool.isDemoMode && sessionId) {
      sql = userId
        ? 'SELECT id, employee_id, name, email, role, phone, department, profile_image FROM users WHERE demo_session_id = ? AND id = ? LIMIT 1'
        : 'SELECT id, employee_id, name, email, role, phone, department, profile_image FROM users WHERE demo_session_id = ? AND email = ? LIMIT 1';
      params = [sessionId, userId || email];
    } else {
      sql = userId
        ? 'SELECT id, employee_id, name, email, role, phone, department, profile_image FROM users WHERE id = ? LIMIT 1'
        : 'SELECT id, employee_id, name, email, role, phone, department, profile_image FROM users WHERE email = ? LIMIT 1';
      params = [userId || email];
    }

    const [rows] = await pool.execute(sql, params);

    if (!rows || rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) return res.status(401).json({ message: 'Authentication required' });

    const body = req.body || {};
    const { userId, email } = authUser;
    const sessionId = getSessionId(req);

    // If role is an approver, department is locked to 'All Departments'
    const roleCheckSql = pool.isDemoMode && sessionId
      ? (userId
          ? 'SELECT role FROM users WHERE demo_session_id = ? AND id = ? LIMIT 1'
          : 'SELECT role FROM users WHERE demo_session_id = ? AND email = ? LIMIT 1')
      : (userId
          ? 'SELECT role FROM users WHERE id = ? LIMIT 1'
          : 'SELECT role FROM users WHERE email = ? LIMIT 1');
    const roleCheckParams = pool.isDemoMode && sessionId ? [sessionId, userId || email] : [userId || email];
    const [userRows] = await pool.execute(roleCheckSql, roleCheckParams);
    const userRoleStr = userRows && userRows[0] ? String(userRows[0].role || '').toLowerCase().trim() : '';
    const isApproverRole = ['accounts', 'manager', 'cfo', 'md'].includes(userRoleStr);

    const updates = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      updates.push('name = ?');
      values.push(body.name ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
      updates.push('phone = ?');
      values.push(body.phone ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'department')) {
      updates.push('department = ?');
      values.push(isApproverRole ? 'All Departments' : (body.department ?? null));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'profile_image')) {
      updates.push('profile_image = ?');
      values.push(body.profile_image ?? null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No profile fields supplied' });
    }

    if (pool.isDemoMode && sessionId) {
      values.push(sessionId, userId || null, email || null);
      await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE demo_session_id = ? AND id = ? AND email = ?`, values);
    } else {
      values.push(userId || null, email || null);
      await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ? AND email = ?`, values);
    }

    const selectSql = pool.isDemoMode && sessionId
      ? (userId
          ? 'SELECT id, employee_id, name, email, role, phone, department, profile_image FROM users WHERE demo_session_id = ? AND id = ? LIMIT 1'
          : 'SELECT id, employee_id, name, email, role, phone, department, profile_image FROM users WHERE demo_session_id = ? AND email = ? LIMIT 1')
      : (userId
          ? 'SELECT id, employee_id, name, email, role, phone, department, profile_image FROM users WHERE id = ? LIMIT 1'
          : 'SELECT id, employee_id, name, email, role, phone, department, profile_image FROM users WHERE email = ? LIMIT 1');
    const selectParams = pool.isDemoMode && sessionId ? [sessionId, userId || email] : [userId || email];

    const [rows] = await pool.execute(selectSql, selectParams);

    res.json({ success: true, user: rows[0] || null });
  } catch (err) {
    next(err);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) return res.status(401).json({ message: 'Authentication required' });

    const { oldPassword, newPassword, confirmPassword } = req.body || {};
    const { userId, email } = authUser;
    const sessionId = getSessionId(req);

    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: 'Current password, new password, and confirmation are required' });
    }

    if (!String(newPassword).trim()) {
      return res.status(400).json({ message: 'New password is required' });
    }

    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({ message: passwordValidation.message });
    }

    if (String(newPassword) !== String(confirmPassword)) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    const selectSql = pool.isDemoMode && sessionId
      ? (userId
          ? 'SELECT password FROM users WHERE demo_session_id = ? AND id = ? LIMIT 1'
          : 'SELECT password FROM users WHERE demo_session_id = ? AND email = ? LIMIT 1')
      : (userId
          ? 'SELECT password FROM users WHERE id = ? LIMIT 1'
          : 'SELECT password FROM users WHERE email = ? LIMIT 1');
    const selectParams = pool.isDemoMode && sessionId ? [sessionId, userId || email] : [userId || email];

    const [rows] = await pool.execute(selectSql, selectParams);
    if (!rows || rows.length === 0) return res.status(404).json({ message: 'User not found' });

    const current = rows[0].password || '';
    const isHashed = typeof current === 'string' && current.startsWith('$2b$');
    let isMatch = false;

    if (isHashed) {
      isMatch = await bcrypt.compare(String(oldPassword), current);
    } else {
      isMatch = String(current) === String(oldPassword);
    }

    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(String(newPassword), 10);

    const updateSql = pool.isDemoMode && sessionId
      ? (userId
          ? 'UPDATE users SET password = ? WHERE demo_session_id = ? AND id = ?'
          : 'UPDATE users SET password = ? WHERE demo_session_id = ? AND email = ?')
      : (userId
          ? 'UPDATE users SET password = ? WHERE id = ?'
          : 'UPDATE users SET password = ? WHERE email = ?');
    const updateParams = pool.isDemoMode && sessionId
      ? [hashedPassword, sessionId, userId || email]
      : [hashedPassword, userId || email];

    await pool.execute(updateSql, updateParams);
    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
};
