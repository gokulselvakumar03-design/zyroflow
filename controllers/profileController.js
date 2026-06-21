const mysql = require('mysql2/promise');
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

exports.getProfile = async (req, res, next) => {
  try {
    const email = String(req.query.email || '').trim();
    if (!email) return res.status(400).json({ message: 'email is required' });

    const [rows] = await pool.execute('SELECT id, name, email, role, phone, department, profile_image FROM users WHERE email = ? LIMIT 1', [email]);
    if (!rows || rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const { email, name, phone, department, profile_image } = req.body || {};
    if (!email) return res.status(400).json({ message: 'email is required' });

    await pool.execute(
      'UPDATE users SET name = ?, phone = ?, department = ?, profile_image = ? WHERE email = ?',
      [name || null, phone || null, department || null, profile_image || null, email]
    );

    const [rows] = await pool.execute('SELECT id, name, email, role, phone, department, profile_image FROM users WHERE email = ? LIMIT 1', [email]);
    res.json({ success: true, user: rows[0] || null });
  } catch (err) {
    next(err);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { email, oldPassword, newPassword } = req.body || {};
    if (!email || !oldPassword || !newPassword) return res.status(400).json({ message: 'email, oldPassword and newPassword are required' });

    const [rows] = await pool.execute('SELECT password FROM users WHERE email = ? LIMIT 1', [email]);
    if (!rows || rows.length === 0) return res.status(404).json({ message: 'User not found' });

    const current = rows[0].password || '';
    if (String(current) !== String(oldPassword)) {
      return res.status(400).json({ message: 'Current password does not match' });
    }

    await pool.execute('UPDATE users SET password = ? WHERE email = ?', [newPassword, email]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
