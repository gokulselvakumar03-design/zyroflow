const pool = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../utils/emailService');

dotenv.config();

exports.login = async (req, res, next) => {
  try {
    const rawEmployeeId = req.body.employee_id || req.body.employeeId || req.body.username || req.body.userId;
    const { password, rememberMe } = req.body;
    const employee_id = rawEmployeeId ? String(rawEmployeeId).trim() : '';

    console.log('\n[AUTH] ========== LOGIN ATTEMPT START ==========');
    console.log('[AUTH] Employee ID received:', employee_id);
    console.log('[AUTH] Password received:', password ? '***' : 'MISSING');
    console.log('[AUTH] Remember Me:', Boolean(rememberMe));

    if (!employee_id || !password) {
      console.log('[AUTH] ❌ Missing employee_id or password');
      return res.status(400).json({ message: 'Employee ID and password are required' });
    }

    const sql = 'SELECT * FROM users WHERE LOWER(TRIM(employee_id)) = LOWER(?) LIMIT 1';
    console.log('[AUTH] Executing query:', sql);
    const [users] = await pool.execute(sql, [employee_id]);
    const user = users[0];

    if (user) {
      console.log('[AUTH] ✓ User found in database');
      console.log('[AUTH] User details - ID:', user.id, 'Employee ID:', user.employee_id, 'Role:', user.role, 'Name:', user.name, 'Status:', user.status);
    } else {
      console.log('[AUTH] ❌ User NOT found in database');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (user.status && user.status.toUpperCase() === 'INACTIVE') {
      console.log('[AUTH] ❌ User is INACTIVE - Login BLOCKED');
      return res.status(403).json({ message: 'Account has been deactivated. Please contact your administrator.' });
    }

    const storedPassword = user.password;
    const isHashed = typeof storedPassword === 'string' && (storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2a$'));
    console.log('[AUTH] Password format:', isHashed ? 'bcrypt hashed' : 'plain text');

    let match = false;
    if (isHashed) {
      match = await bcrypt.compare(password, storedPassword);
      console.log('[AUTH] Bcrypt comparison result:', match);
    } else {
      match = password === storedPassword;
      console.log('[AUTH] Plain text comparison match:', match);
    }

    if (!match) {
      console.log('[AUTH] ❌ Password mismatch - Login FAILED');
      console.log('[AUTH] ========== LOGIN ATTEMPT END (FAILED) ==========\n');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    console.log('[AUTH] ✓ Password matched successfully');
    console.log('[AUTH] Detected role:', user.role);

    const payload = { id: user.id, role: user.role, name: user.name || null, email: user.email, employee_id: user.employee_id };
    const tokenExpiry = rememberMe ? '30d' : (process.env.JWT_EXPIRES_IN || '24h');
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: tokenExpiry });

    console.log('[AUTH] ✓ JWT token created');
    console.log('[AUTH] Returning to client - role:', user.role, 'userId:', user.id, 'employee_id:', user.employee_id);
    console.log('[AUTH] ========== LOGIN ATTEMPT END (SUCCESS) ==========\n');

    const isAdmin = String(user.role || '').toLowerCase() === 'admin';
    const hasRecoveryEmail =
      isAdmin ||
      Boolean(user.recovery_email && String(user.recovery_email).trim().length > 0);

    res.json({
      token,
      role: user.role,
      userId: user.id,
      employee_id: user.employee_id || '',
      employeeId: user.employee_id || '',
      name: user.name || '',
      email: user.email || '',
      department: user.department || '',
      hasRecoveryEmail,
      user: {
        id: user.id,
        employee_id: user.employee_id || '',
        employeeId: user.employee_id || '',
        name: user.name || '',
        email: user.email || '',
        role: user.role || '',
        department: user.department || '',
        phone: user.phone || '',
        status: user.status || 'ACTIVE',
        hasRecoveryEmail
      }
    });
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

exports.saveRecoveryEmail = async (req, res, next) => {
    try {
        const { userId, recoveryEmail } = req.body;

        if (!userId || !recoveryEmail) {
            return res.status(400).json({
                success: false,
                message: 'User ID and recovery email are required.'
            });
        }

        const email = String(recoveryEmail).trim().toLowerCase();

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid recovery email address.'
            });
        }

        const [result] = await pool.execute(
            'UPDATE users SET recovery_email = ? WHERE id = ?',
            [email, userId]
        );

        if (!result || result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found.'
            });
        }

        return res.json({
            success: true,
            message: 'Recovery email saved successfully.'
        });

    } catch (err) {
        console.error('[AUTH] Recovery email save error:', err);
        next(err);
    }
};

exports.setRecoveryEmail = exports.saveRecoveryEmail;

/**
 * Initiates the forgot password workflow:
 * 1. Takes login identifier (login email or employee ID).
 * 2. Looks up the user in the database.
 * 3. If non-admin and recovery_email exists: generates secure random token, stores SHA-256 hash in DB with 30-min expiry, sends reset email to recovery_email.
 * 4. Always returns the same generic message to prevent account enumeration.
 */
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email, loginId, loginIdentifier } = req.body || {};
    const inputIdentifier = String(loginIdentifier || email || loginId || '').trim();

    const genericMessage = 'If the account exists and has a recovery email configured, a password reset link has been sent.';

    if (!inputIdentifier) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your login email address.'
      });
    }

    // Lookup user by login email or employee_id
    const [rows] = await pool.execute(
      'SELECT id, name, email, employee_id, role, recovery_email, status FROM users WHERE LOWER(TRIM(email)) = LOWER(?) OR LOWER(TRIM(employee_id)) = LOWER(?) LIMIT 1',
      [inputIdentifier, inputIdentifier]
    );

    if (!rows || rows.length === 0) {
      // User not found -> generic response
      return res.json({
        success: true,
        message: genericMessage
      });
    }

    const user = rows[0];
    const isAdmin = String(user.role || '').toLowerCase() === 'admin';
    const recoveryEmail = (user.recovery_email || '').trim();

    // If Admin or no recovery email -> generic response (no email sent)
    if (isAdmin || !recoveryEmail) {
      return res.json({
        success: true,
        message: genericMessage
      });
    }

    // Generate 32 bytes cryptographically secure random token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // 30 minutes expiration
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    // Save token hash to database
    await pool.execute(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [user.id, tokenHash, expiresAt]
    );

    // Send reset email to the stored recovery email
    await sendPasswordResetEmail(recoveryEmail, rawToken);

    return res.json({
      success: true,
      message: genericMessage
    });

  } catch (err) {
    console.error('[AUTH] Forgot password error:', err);
    next(err);
  }
};

/**
 * Completes the reset password workflow:
 * 1. Validates token hash and checks used_at / expires_at.
 * 2. Hashes the new password using bcrypt (cost 10).
 * 3. Updates users.password and marks token as used.
 */
exports.resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword, confirmPassword } = req.body || {};

    if (!token || !String(token).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Reset token is required.'
      });
    }

    if (!newPassword || !String(newPassword).trim()) {
      return res.status(400).json({
        success: false,
        message: 'New password is required.'
      });
    }

    if (confirmPassword !== undefined && String(newPassword) !== String(confirmPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match.'
      });
    }

    const cleanToken = String(token).trim();
    const tokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');

    const [rows] = await pool.execute(
      'SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ? LIMIT 1',
      [tokenHash]
    );

    if (!rows || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired password reset link.'
      });
    }

    const record = rows[0];

    if (record.used_at) {
      return res.status(400).json({
        success: false,
        message: 'This password reset link has already been used.'
      });
    }

    const now = new Date();
    const expiresAt = new Date(record.expires_at);

    if (expiresAt < now) {
      return res.status(400).json({
        success: false,
        message: 'This password reset link has expired. Please request a new one.'
      });
    }

    // Verify user exists
    const [userRows] = await pool.execute(
      'SELECT id FROM users WHERE id = ? LIMIT 1',
      [record.user_id]
    );

    if (!userRows || userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User account not found.'
      });
    }

    // Hash the new password with bcrypt
    const hashedPassword = await bcrypt.hash(String(newPassword), 10);

    // Update user's password in users table
    await pool.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, record.user_id]
    );

    // Mark the reset token as used
    await pool.execute(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?',
      [record.id]
    );

    return res.json({
      success: true,
      message: 'Password reset successful. You can now log in.'
    });

  } catch (err) {
    console.error('[AUTH] Reset password error:', err);
    next(err);
  }
};

/**
 * Validates the currently active JWT token and returns the current user profile.
 * Used for session verification during Remember Me automatic login.
 */
exports.verifyToken = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const [rows] = await pool.execute(
      'SELECT id, employee_id, name, email, role, department, phone, profile_image, status, recovery_email FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User account not found' });
    }

    const user = rows[0];

    if (user.status && user.status.toUpperCase() === 'INACTIVE') {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    const isAdmin = String(user.role || '').toLowerCase() === 'admin';
    const hasRecoveryEmail =
      isAdmin ||
      Boolean(user.recovery_email && String(user.recovery_email).trim().length > 0);

    return res.json({
      success: true,
      user: {
        id: user.id,
        employee_id: user.employee_id || '',
        employeeId: user.employee_id || '',
        name: user.name || '',
        email: user.email || '',
        role: user.role || '',
        department: user.department || '',
        phone: user.phone || '',
        status: user.status || 'ACTIVE',
        hasRecoveryEmail
      }
    });

  } catch (err) {
    console.error('[AUTH] Verify token error:', err);
    next(err);
  }
};



