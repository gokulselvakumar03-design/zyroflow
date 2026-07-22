const pool = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    console.log('\n[AUTH] ========== LOGIN ATTEMPT START ==========');
    console.log('[AUTH] Email received:', email);
    console.log('[AUTH] Password received:', password ? '***' : 'MISSING');

    if (!email || !password) {
      console.log('[AUTH] ❌ Missing email or password');
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const sql = 'SELECT * FROM users WHERE email = ?';
    console.log('[AUTH] Executing query:', sql);
    const [users] = await pool.execute(sql, [email]);
    const user = users[0];

    if (user) {
      console.log('[AUTH] ✓ User found in database');
      console.log('[AUTH] User details - ID:', user.id, 'Email:', user.email, 'Role:', user.role, 'Name:', user.name, 'Status:', user.status);
    } else {
      console.log('[AUTH] ❌ User NOT found in database');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (user.status && user.status.toUpperCase() === 'INACTIVE') {
      console.log('[AUTH] ❌ User is INACTIVE - Login BLOCKED');
      return res.status(403).json({ message: 'Account has been deactivated. Please contact your administrator.' });
    }

    const storedPassword = user.password;
    const isHashed = typeof storedPassword === 'string' && storedPassword.startsWith('$2b$');
    console.log('[AUTH] Password format:', isHashed ? 'bcrypt hashed' : 'plain text');
    console.log('[AUTH] Stored password (first 20 chars):', storedPassword.substring(0, 20));

    let match = false;
    if (isHashed) {
      match = await bcrypt.compare(password, storedPassword);
      console.log('[AUTH] Bcrypt comparison result:', match);
    } else {
      match = password === storedPassword;
      console.log('[AUTH] Plain text comparison - Input:', password, 'Stored:', storedPassword, 'Match:', match);
    }

    if (!match) {
      console.log('[AUTH] ❌ Password mismatch - Login FAILED');
      console.log('[AUTH] ========== LOGIN ATTEMPT END (FAILED) ==========\n');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    console.log('[AUTH] ✓ Password matched successfully');
    console.log('[AUTH] Detected role:', user.role);

    const payload = { id: user.id, role: user.role, name: user.name || null, email: user.email };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });

    console.log('[AUTH] ✓ JWT token created');
    console.log('[AUTH] Returning to client - role:', user.role, 'userId:', user.id);
    console.log('[AUTH] ========== LOGIN ATTEMPT END (SUCCESS) ==========\n');

    res.json({ token, role: user.role, userId: user.id, employee_id: user.employee_id || '', employeeId: user.employee_id || '' });
  } catch (err) {
    console.log('[AUTH] ❌ Exception occurred:', err.message);
    console.log('[AUTH] ========== LOGIN ATTEMPT END (ERROR) ==========\n');
    next(err);
  }
};

exports.createUser = async (req, res, next) => {
  try {
    const { name, email, password, role, department, phone } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Name, email, password, and role are required.' });
    }

    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing && existing.length > 0) {
      return res.status(400).json({ message: 'User with this email already exists.' });
    }

    // Map user role to its prefix (ADM, EMP, MGR, ACC, CFO, MD)
    const getRolePrefix = (roleStr) => {
      const r = String(roleStr || '').toLowerCase().trim();
      if (r === 'admin') return 'ADM';
      if (r === 'employee') return 'EMP';
      if (r === 'manager') return 'MGR';
      if (r === 'accounts') return 'ACC';
      if (r === 'cfo') return 'CFO';
      if (r === 'md') return 'MD';
      return 'EMP';
    };

    const prefix = getRolePrefix(role);

    // Generate unique auto-incrementing Employee ID for the given role prefix
    const [maxRow] = await pool.execute(
      "SELECT employee_id FROM users WHERE employee_id LIKE ? ORDER BY CAST(SUBSTRING(employee_id, ?) AS UNSIGNED) DESC LIMIT 1",
      [`${prefix}%`, prefix.length + 1]
    );
    let nextNum = 1;
    if (maxRow && maxRow[0] && maxRow[0].employee_id) {
      const numPart = maxRow[0].employee_id.substring(prefix.length);
      const parsed = parseInt(numPart, 10);
      if (!isNaN(parsed)) {
        nextNum = parsed + 1;
      }
    }

    const employee_id = `${prefix}${String(nextNum).padStart(3, '0')}`;

    const [result] = await pool.execute(
      'INSERT INTO users (employee_id, name, email, password, role, department, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [employee_id, name, email, password, role, department || '', phone || '', 'ACTIVE']
    );

    res.status(201).json({
      success: true,
      message: 'User Created Successfully',
      employee_id,
      employeeId: employee_id,
      user: {
        id: result.insertId,
        employee_id,
        employeeId: employee_id,
        name,
        email,
        role,
        department: department || '',
        phone: phone || '',
        status: 'ACTIVE'
      }
    });
  } catch (err) {
    console.error("========== CREATE USER ERROR ==========");
    console.error("Message:", err.message);
    console.error("Code:", err.code);
    console.error("SQL:", err.sql);
    console.error("SQL State:", err.sqlState);
    console.error(err);
    return res.status(500).json({
      success: false,
      message: err.message,
      code: err.code,
      sql: err.sql,
      sqlState: err.sqlState
    });
  }
};

exports.getUsers = async (req, res, next) => {
  try {
    const [db] = await pool.execute("SELECT DATABASE() AS db");
    console.log("Connected Database:", db[0].db);

    const [cols] = await pool.execute("SHOW COLUMNS FROM users");
    console.table(cols);

    const [users] = await pool.execute(`
      SELECT
        id,
        employee_id,
        name,
        email,
        role,
        department,
        phone,
        profile_image,
        status
      FROM users
      ORDER BY id ASC
    `);

    const formatted = users.map(u => ({
      ...u,
      employeeId: u.employee_id || "",
      status: u.status || "ACTIVE"
    }));

    res.json(formatted);

  } catch (err) {
    console.error("========== GET USERS ERROR ==========");
    console.error(err);
    res.status(500).json({
      message: err.message,
      code: err.code,
      sql: err.sql
    });
  }
};

exports.updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, phone, department, role } = req.body;

    if (!name || !email || !role || !department) {
      return res.status(400).json({ message: 'Name, email, role, and department are required.' });
    }

    const [existingUser] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
    if (!existingUser || existingUser.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const [duplicateEmail] = await pool.execute('SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1', [email, id]);
    if (duplicateEmail && duplicateEmail.length > 0) {
      return res.status(400).json({ message: 'User with this email already exists.' });
    }

    await pool.execute(
      'UPDATE users SET name = ?, email = ?, phone = ?, department = ?, role = ? WHERE id = ?',
      [name, email, phone || '', department, role, id]
    );

    const [updatedRows] = await pool.execute('SELECT id, employee_id, name, email, role, department, phone, profile_image, status, created_at FROM users WHERE id = ?', [id]);
    const updatedUser = updatedRows[0];

    res.json({
      success: true,
      message: 'User Updated Successfully',
      user: {
        ...updatedUser,
        employeeId: updatedUser.employee_id || '',
        status: updatedUser.status || 'ACTIVE'
      }
    });
  } catch (err) {
    console.error("========== UPDATE USER ERROR ==========");
    console.error("Message:", err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'User with this email already exists.' });
    }
    next(err);
  }
};

exports.activateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [existingUser] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
    if (!existingUser || existingUser.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    await pool.execute('UPDATE users SET status = ? WHERE id = ?', ['ACTIVE', id]);
    const [updatedRows] = await pool.execute('SELECT id, employee_id, name, email, role, department, phone, profile_image, status FROM users WHERE id = ?', [id]);
    const updatedUser = updatedRows[0];

    res.json({
      success: true,
      message: 'User Activated Successfully',
      user: {
        ...updatedUser,
        employeeId: updatedUser.employee_id || ''
      }
    });
  } catch (err) {
    console.error("========== ACTIVATE USER ERROR ==========", err.message);
    next(err);
  }
};

exports.deactivateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [existingUser] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
    if (!existingUser || existingUser.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const user = existingUser[0];
    const roleStr = String(user.role || '').trim().toLowerCase();

    if (roleStr === 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Administrator accounts cannot be deactivated.'
      });
    }

    await pool.execute('UPDATE users SET status = ? WHERE id = ?', ['INACTIVE', id]);
    const [updatedRows] = await pool.execute('SELECT id, employee_id, name, email, role, department, phone, profile_image, status FROM users WHERE id = ?', [id]);
    const updatedUser = updatedRows[0];

    res.json({
      success: true,
      message: 'User Deactivated Successfully',
      user: {
        ...updatedUser,
        employeeId: updatedUser.employee_id || ''
      }
    });
  } catch (err) {
    console.error("========== DEACTIVATE USER ERROR ==========", err.message);
    next(err);
  }
};

