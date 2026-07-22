const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
  user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
  password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.MYSQL_DB || process.env.DB_NAME || 'zyroflow',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

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
    const [rows] = userId
      ? await pool.execute('SELECT id, employee_id, name, email, role, phone, department, profile_image FROM users WHERE id = ? LIMIT 1', [userId])
      : await pool.execute('SELECT id, employee_id, name, email, role, phone, department, profile_image FROM users WHERE email = ? LIMIT 1', [email]);

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
      values.push(body.department ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'profile_image')) {
      updates.push('profile_image = ?');
      values.push(body.profile_image ?? null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No profile fields supplied' });
    }

    values.push(userId || null, email || null);
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ? AND email = ?`, values);

    const [rows] = userId
      ? await pool.execute('SELECT id, employee_id, name, email, role, phone, department, profile_image FROM users WHERE id = ? LIMIT 1', [userId])
      : await pool.execute('SELECT id, employee_id, name, email, role, phone, department, profile_image FROM users WHERE email = ? LIMIT 1', [email]);

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

    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: 'Current password, new password, and confirmation are required' });
    }

    if (!String(newPassword).trim()) {
      return res.status(400).json({ message: 'New password is required' });
    }

    if (String(newPassword) !== String(confirmPassword)) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    const [rows] = userId
      ? await pool.execute('SELECT password FROM users WHERE id = ? LIMIT 1', [userId])
      : await pool.execute('SELECT password FROM users WHERE email = ? LIMIT 1', [email]);
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
    await pool.execute(
      userId ? 'UPDATE users SET password = ? WHERE id = ?' : 'UPDATE users SET password = ? WHERE email = ?',
      [hashedPassword, userId || email]
    );
    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
};
