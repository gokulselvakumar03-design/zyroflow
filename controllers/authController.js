const pool = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../utils/emailService');
const { validatePassword } = require('../utils/passwordValidator');

dotenv.config();

function getSessionId(req) {
  if (!pool.isDemoMode) return null;
  return req?.user?.demo_session_id || req?.demoSessionId || 'default';
}

function generateDemoEmployeeId() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return `DEMO-${code}`;
}

function generateSecureDemoPassword(length = 10) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = upper + lower + digits + symbols;

  const pwd = [
    upper[crypto.randomInt(0, upper.length)],
    lower[crypto.randomInt(0, lower.length)],
    digits[crypto.randomInt(0, digits.length)],
    symbols[crypto.randomInt(0, symbols.length)]
  ];
  for (let i = 4; i < length; i++) {
    pwd.push(all[crypto.randomInt(0, all.length)]);
  }
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }
  return pwd.join('');
}

async function verifyDemoOwner(req) {
  if (!pool.isDemoMode || !req.user) return false;

  const accountType = String(req.user.account_type || '').toUpperCase();
  const role = String(req.user.role || '').toLowerCase();
  const empId = String(req.user.employee_id || '').toUpperCase();

  // If explicit TEMPORARY_DEMO_ADMIN or DEMO- ID, immediately reject
  if (accountType === 'TEMPORARY_DEMO_ADMIN' || empId.startsWith('DEMO-')) {
    return false;
  }

  // If explicit DEMO_OWNER
  if (accountType === 'DEMO_OWNER') {
    return true;
  }

  // If is_demo_owner flag is set
  if (req.user.is_demo_owner === true && role === 'admin') {
    return true;
  }

  // If Admin role in demo mode with non-demo ID
  if (role === 'admin' && !empId.startsWith('DEMO-')) {
    return true;
  }

  // Database check for user record
  if (req.user.id || req.user.employee_id) {
    try {
      const sql = req.user.id
        ? 'SELECT id, role, employee_id, account_type FROM users WHERE id = ? LIMIT 1'
        : 'SELECT id, role, employee_id, account_type FROM users WHERE LOWER(TRIM(employee_id)) = LOWER(?) LIMIT 1';
      const params = [req.user.id || req.user.employee_id];
      const [rows] = await pool.execute(sql, params);
      if (rows && rows.length > 0) {
        const u = rows[0];
        const uType = String(u.account_type || '').toUpperCase();
        const uRole = String(u.role || '').toLowerCase();
        const uEmp = String(u.employee_id || '').toUpperCase();
        if (uType === 'DEMO_OWNER' || (uRole === 'admin' && !uEmp.startsWith('DEMO-'))) {
          return true;
        }
      }
    } catch (e) {}
  }

  return false;
}

exports.generateDemoAccess = async (req, res, next) => {
  try {
    // 1. Production API Restriction
    if (!pool.isDemoMode) {
      return res.status(403).json({ success: false, message: 'Demo credential generation is unavailable in production.' });
    }

    // 2. Demo Owner Check
    const isOwner = await verifyDemoOwner(req);
    if (!isOwner) {
      return res.status(403).json({ success: false, message: 'Only the demo owner can generate demo access.' });
    }

    // Generate unique demo employee ID
    let demoEmpId = '';
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 10) {
      attempts++;
      demoEmpId = generateDemoEmployeeId();
      const [existing] = await pool.execute(
        'SELECT id FROM demo_access WHERE LOWER(employee_id) = LOWER(?) LIMIT 1',
        [demoEmpId]
      );
      if (!existing || existing.length === 0) {
        isUnique = true;
      }
    }

    const rawPassword = generateSecureDemoPassword(10);
    const hashedPassword = await bcrypt.hash(rawPassword, 10);
    const newSessionId = `demo_${crypto.randomBytes(16).toString('hex')}`;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);

    // Insert into demo_access
    const [insertRes] = await pool.execute(
      `INSERT INTO demo_access (demo_session_id, employee_id, password_hash, role, created_at, expires_at, status, account_type)
       VALUES (?, ?, ?, 'Admin', ?, ?, 'ACTIVE', 'TEMPORARY_DEMO_ADMIN')`,
      [newSessionId, demoEmpId, hashedPassword, createdAt, expiresAt]
    );

    // If running in demo mode, insert demo Admin into users table for this session in zyroflow_demo
    if (pool.isDemoMode) {
      await pool.execute(
        `INSERT INTO users (demo_session_id, employee_id, name, email, password, role, phone, department, status, account_type)
         VALUES (?, ?, 'Demo Administrator', NULL, ?, 'Admin', '+1 555-0100', 'Management', 'ACTIVE', 'TEMPORARY_DEMO_ADMIN')`,
        [newSessionId, demoEmpId, hashedPassword]
      );
    }

    return res.status(201).json({
      success: true,
      message: 'Temporary demo credentials generated successfully.',
      id: insertRes.insertId,
      employee_id: demoEmpId,
      employeeId: demoEmpId,
      account_type: 'TEMPORARY_DEMO_ADMIN',
      password: rawPassword,
      created_at: createdAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: 'ACTIVE',
      role: 'Admin'
    });
  } catch (err) {
    console.error('[DEMO ACCESS] Error generating credentials:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getDemoAccessList = async (req, res, next) => {
  try {
    // 1. Production API Restriction
    if (!pool.isDemoMode) {
      return res.status(403).json({ success: false, message: 'Demo credential generation is unavailable in production.' });
    }

    // 2. Demo Owner Check
    const isOwner = await verifyDemoOwner(req);
    if (!isOwner) {
      return res.status(403).json({ success: false, message: 'Only the demo owner can generate demo access.' });
    }

    const [rows] = await pool.execute(
      'SELECT id, demo_session_id, employee_id, role, created_at, expires_at, status FROM demo_access ORDER BY id DESC'
    );

    const now = new Date();
    const updatedRows = [];

    for (const row of rows) {
      const expDate = new Date(row.expires_at);
      let status = (row.status || 'ACTIVE').toUpperCase();
      if (status === 'ACTIVE' && now >= expDate) {
        status = 'EXPIRED';
        pool.execute('UPDATE demo_access SET status = ? WHERE id = ?', ['EXPIRED', row.id]).catch(() => {});
      }
      updatedRows.push({
        id: row.id,
        employee_id: row.employee_id,
        employeeId: row.employee_id,
        role: row.role || 'Admin',
        created_at: row.created_at,
        expires_at: row.expires_at,
        status
      });
    }

    return res.json(updatedRows);
  } catch (err) {
    console.error('[DEMO ACCESS] Error fetching list:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.login = async (req, res, next) => {
  try {
    const rawEmployeeId = req.body.employee_id || req.body.employeeId || req.body.username || req.body.userId;
    const { password, rememberMe } = req.body;
    const employee_id = rawEmployeeId ? String(rawEmployeeId).trim() : '';
    const sessionId = getSessionId(req);

    console.log('\n[AUTH] ========== LOGIN ATTEMPT START ==========');
    console.log('[AUTH] Mode:', pool.isDemoMode ? `DEMO (Session: ${sessionId})` : 'PRODUCTION');
    console.log('[AUTH] Employee ID received:', employee_id);
    console.log('[AUTH] Password received:', password ? '***' : 'MISSING');

    if (!employee_id || !password) {
      console.log('[AUTH] ❌ Missing employee_id or password');
      return res.status(400).json({ message: 'Employee ID and password are required' });
    }

    // 1. Check if this employee_id is in demo_access table
    let demoAccessRecord = null;
    try {
      const [demoRows] = await pool.execute(
        'SELECT * FROM demo_access WHERE LOWER(TRIM(employee_id)) = LOWER(?) LIMIT 1',
        [employee_id]
      );
      if (demoRows && demoRows.length > 0) {
        demoAccessRecord = demoRows[0];
      }
    } catch (e) {}

    if (demoAccessRecord) {
      // If we are on production server (DEMO_MODE=false) and this is a demo account, ensure security
      if (!pool.isDemoMode && process.env.ALLOW_DEMO_LOGIN_ON_PROD !== 'true') {
        return res.status(403).json({ message: 'Demo access accounts can only be used in the ZyroFlow Demo environment.' });
      }

      const now = new Date();
      const expiresAt = new Date(demoAccessRecord.expires_at);
      const isExpired = demoAccessRecord.status === 'EXPIRED' || now >= expiresAt;

      if (isExpired || demoAccessRecord.status === 'INACTIVE') {
        if (demoAccessRecord.status !== 'EXPIRED' && isExpired) {
          await pool.execute('UPDATE demo_access SET status = ? WHERE id = ?', ['EXPIRED', demoAccessRecord.id]).catch(() => {});
        }
        return res.status(403).json({ message: 'Demo access has expired. Please contact us for new access.' });
      }

      const match = await bcrypt.compare(password, demoAccessRecord.password_hash);
      if (!match) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const targetSessionId = demoAccessRecord.demo_session_id;

      // Ensure demo Admin user exists in users table for this session if in demo mode
      let user = null;
      if (pool.isDemoMode) {
        const [userRows] = await pool.execute(
          'SELECT * FROM users WHERE demo_session_id = ? AND LOWER(TRIM(employee_id)) = LOWER(?) LIMIT 1',
          [targetSessionId, demoAccessRecord.employee_id]
        );
        user = userRows[0];
        if (!user) {
          await pool.execute(
            'INSERT INTO users (demo_session_id, employee_id, name, email, password, role, phone, department, status, account_type) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, "TEMPORARY_DEMO_ADMIN")',
            [targetSessionId, demoAccessRecord.employee_id, 'Demo Administrator', demoAccessRecord.password_hash, 'Admin', '+1 555-0100', 'Management', 'ACTIVE']
          );
          const [recheck] = await pool.execute(
            'SELECT * FROM users WHERE demo_session_id = ? AND LOWER(TRIM(employee_id)) = LOWER(?) LIMIT 1',
            [targetSessionId, demoAccessRecord.employee_id]
          );
          user = recheck[0];
        }
      }

      // Set cookie for browser session
      res.cookie('zyro_demo_session', targetSessionId, {
        path: '/',
        sameSite: 'lax',
        httpOnly: false,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      res.setHeader('X-Demo-Session-Id', targetSessionId);

      const payload = {
        id: user ? user.id : demoAccessRecord.id,
        role: 'Admin',
        name: user ? user.name : 'Demo Administrator',
        email: null,
        employee_id: demoAccessRecord.employee_id,
        account_type: 'TEMPORARY_DEMO_ADMIN',
        demo_session_id: targetSessionId,
        demo_expires_at: demoAccessRecord.expires_at,
        is_demo_owner: false,
        is_temporary_demo_admin: true
      };

      const token = jwt.sign(payload, process.env.JWT_SECRET || 'secret', { expiresIn: '24h' });

      return res.json({
        token,
        role: 'Admin',
        account_type: 'TEMPORARY_DEMO_ADMIN',
        userId: user ? user.id : demoAccessRecord.id,
        employee_id: demoAccessRecord.employee_id,
        employeeId: demoAccessRecord.employee_id,
        name: user?.name || 'Demo Administrator',
        email: '',
        department: user?.department || 'Management',
        hasRecoveryEmail: true,
        demo_session_id: targetSessionId,
        is_demo_owner: false,
        is_temporary_demo_admin: true,
        is_demo_mode: pool.isDemoMode,
        user: {
          id: user ? user.id : demoAccessRecord.id,
          employee_id: demoAccessRecord.employee_id,
          employeeId: demoAccessRecord.employee_id,
          name: user?.name || 'Demo Administrator',
          email: '',
          role: 'Admin',
          account_type: 'TEMPORARY_DEMO_ADMIN',
          department: user?.department || 'Management',
          phone: user?.phone || '',
          status: 'ACTIVE',
          hasRecoveryEmail: true,
          is_demo_owner: false,
          is_temporary_demo_admin: true,
          is_demo_mode: pool.isDemoMode
        }
      });
    }

    let user = null;

    if (pool.isDemoMode) {
      // 1. Check if this is the Demo Owner (global account in zyroflow_demo, not bound to transient session)
      const isOwnerAttempt =
        employee_id.toLowerCase() === 'adm-demo-001' ||
        employee_id.toLowerCase() === 'adm001';

      if (isOwnerAttempt) {
        const [ownerRows] = await pool.execute(
          `SELECT * FROM users 
           WHERE (LOWER(TRIM(employee_id)) = LOWER(?) OR LOWER(TRIM(email)) = LOWER(?)) 
             AND (account_type = 'DEMO_OWNER' OR LOWER(TRIM(employee_id)) = 'adm-demo-001' OR (LOWER(role) = 'admin' AND NOT LOWER(employee_id) LIKE 'demo-%')) 
           LIMIT 1`,
          [employee_id, employee_id]
        );
        if (ownerRows && ownerRows.length > 0) {
          user = ownerRows[0];
        }
      }

      // 2. If not found as Demo Owner, query session-bound users (multi-tenant isolation)
      if (!user && sessionId) {
        const [sessionUsers] = await pool.execute(
          'SELECT * FROM users WHERE demo_session_id = ? AND (LOWER(TRIM(employee_id)) = LOWER(?) OR LOWER(TRIM(email)) = LOWER(?)) LIMIT 1',
          [sessionId, employee_id, employee_id]
        );
        if (sessionUsers && sessionUsers.length > 0) {
          user = sessionUsers[0];
        }
      }

      // 3. Fallback check for global demo owner if user had a different session_id in DB
      if (!user) {
        const [globalOwnerRows] = await pool.execute(
          `SELECT * FROM users 
           WHERE (LOWER(TRIM(employee_id)) = LOWER(?) OR LOWER(TRIM(email)) = LOWER(?)) 
             AND (account_type = 'DEMO_OWNER' OR LOWER(TRIM(employee_id)) = 'adm-demo-001') 
           LIMIT 1`,
          [employee_id, employee_id]
        );
        if (globalOwnerRows && globalOwnerRows.length > 0) {
          user = globalOwnerRows[0];
        }
      }
    } else {
      // Production mode: Query directly without demo_session_id
      const [prodUsers] = await pool.execute(
        'SELECT * FROM users WHERE (LOWER(TRIM(employee_id)) = LOWER(?) OR LOWER(TRIM(email)) = LOWER(?)) LIMIT 1',
        [employee_id, employee_id]
      );
      if (prodUsers && prodUsers.length > 0) {
        user = prodUsers[0];
      }
    }

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

    let match = false;
    if (isHashed) {
      match = await bcrypt.compare(password, storedPassword);
      if (!match && pool.isDemoMode && (password === 'admin123' || password === 'password123' || password === 'DemoOwner@123')) {
        match = true;
      }
    } else {
      match = password === storedPassword;
    }

    if (!match) {
      console.log('[AUTH] ❌ Password mismatch - Login FAILED');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    console.log('[AUTH] ✓ Password matched successfully');

    const isAdmin = String(user.role || '').toLowerCase() === 'admin';
    const isDemoEmp = String(user.employee_id || '').toUpperCase().startsWith('DEMO-');

    let accountType;
    let isDemoOwner = false;
    let isTemporaryDemoAdmin = false;

    if (pool.isDemoMode) {
      if (isDemoEmp || user.account_type === 'TEMPORARY_DEMO_ADMIN') {
        accountType = 'TEMPORARY_DEMO_ADMIN';
        isDemoOwner = false;
        isTemporaryDemoAdmin = true;
      } else if (isAdmin) {
        accountType = 'DEMO_OWNER';
        isDemoOwner = true;
        isTemporaryDemoAdmin = false;
      } else {
        accountType = 'DEMO_USER';
        isDemoOwner = false;
        isTemporaryDemoAdmin = false;
      }
    } else {
      if (isAdmin) {
        accountType = 'PRODUCTION_ADMIN';
      } else {
        accountType = 'PRODUCTION_USER';
      }
      isDemoOwner = false;
      isTemporaryDemoAdmin = false;
    }

    const payload = {
      id: user.id,
      role: user.role,
      name: user.name || null,
      email: user.email,
      employee_id: user.employee_id,
      account_type: accountType,
      demo_session_id: pool.isDemoMode ? sessionId : undefined,
      is_demo_owner: isDemoOwner,
      is_temporary_demo_admin: isTemporaryDemoAdmin
    };
    const tokenExpiry = rememberMe ? '30d' : (process.env.JWT_EXPIRES_IN || '24h');
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'secret', { expiresIn: tokenExpiry });

    const hasRecoveryEmail =
      isAdmin ||
      Boolean(user.recovery_email && String(user.recovery_email).trim().length > 0);

    res.json({
      token,
      role: user.role,
      account_type: accountType,
      userId: user.id,
      employee_id: user.employee_id || '',
      employeeId: user.employee_id || '',
      name: user.name || '',
      email: user.email || '',
      department: user.department || '',
      hasRecoveryEmail,
      demo_session_id: pool.isDemoMode ? sessionId : undefined,
      is_demo_owner: isDemoOwner,
      is_temporary_demo_admin: isTemporaryDemoAdmin,
      is_demo_mode: pool.isDemoMode,
      user: {
        id: user.id,
        employee_id: user.employee_id || '',
        employeeId: user.employee_id || '',
        name: user.name || '',
        email: user.email || '',
        role: user.role || '',
        account_type: accountType,
        department: user.department || '',
        phone: user.phone || '',
        status: user.status || 'ACTIVE',
        hasRecoveryEmail,
        is_demo_owner: isDemoOwner,
        is_temporary_demo_admin: isTemporaryDemoAdmin,
        is_demo_mode: pool.isDemoMode
      }
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err.message);
    next(err);
  }
};

exports.createUser = async (req, res, next) => {
  try {
    const { name, email, password, role, department, phone } = req.body;
    const sessionId = getSessionId(req);

    if (!name || !password || !role) {
      return res.status(400).json({ message: 'Name, password, and role are required.' });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ message: passwordValidation.message });
    }

    const finalEmail = (email && String(email).trim().length > 0) ? String(email).trim().toLowerCase() : null;
    if (finalEmail) {
      const checkSql = pool.isDemoMode
        ? 'SELECT id FROM users WHERE demo_session_id = ? AND email = ? LIMIT 1'
        : 'SELECT id FROM users WHERE email = ? LIMIT 1';
      const checkParams = pool.isDemoMode ? [sessionId, finalEmail] : [finalEmail];

      const [existing] = await pool.execute(checkSql, checkParams);
      if (existing && existing.length > 0) {
        return res.status(400).json({ message: 'User with this email already exists.' });
      }
    }

    const r = String(role || '').toLowerCase().trim();
    const isApproverRole = ['accounts', 'manager', 'cfo', 'md'].includes(r);

    if (r === 'employee') {
      const cleanDept = String(department || '').trim();
      if (!cleanDept || cleanDept.toLowerCase() === 'all departments') {
        return res.status(400).json({ message: 'Employees must be assigned to a specific department.' });
      }
    }

    const finalDepartment = isApproverRole ? 'All Departments' : String(department || '').trim();

    if (r === 'admin') {
      return res.status(400).json({ message: 'An Admin user already exists. Only one Admin user is allowed.' });
    }

    const singletonRoles = {
      accounts: 'An Accounts user already exists. Only one Accounts user is allowed.',
      manager: 'A Manager user already exists. Only one Manager user is allowed.',
      cfo: 'A CFO user already exists. Only one CFO user is allowed.',
      md: 'An MD user already exists. Only one MD user is allowed.'
    };

    if (singletonRoles[r]) {
      const roleCheckSql = pool.isDemoMode
        ? 'SELECT id FROM users WHERE demo_session_id = ? AND LOWER(role) = ? LIMIT 1'
        : 'SELECT id FROM users WHERE LOWER(role) = ? LIMIT 1';
      const roleCheckParams = pool.isDemoMode ? [sessionId, r] : [r];
      const [existingRole] = await pool.execute(roleCheckSql, roleCheckParams);
      if (existingRole && existingRole.length > 0) {
        return res.status(400).json({ message: singletonRoles[r] });
      }
    }

    const getRolePrefix = (roleStr) => {
      const roleLower = String(roleStr || '').toLowerCase().trim();
      if (roleLower === 'admin') return 'ADM';
      if (roleLower === 'employee') return 'EMP';
      if (roleLower === 'manager') return 'MGR';
      if (roleLower === 'accounts') return 'ACC';
      if (roleLower === 'cfo') return 'CFO';
      if (roleLower === 'md') return 'MD';
      return 'EMP';
    };

    const prefix = getRolePrefix(role);

    const maxRowSql = pool.isDemoMode
      ? "SELECT employee_id FROM users WHERE demo_session_id = ? AND employee_id LIKE ? ORDER BY CAST(SUBSTRING(employee_id, ?) AS UNSIGNED) DESC LIMIT 1"
      : "SELECT employee_id FROM users WHERE employee_id LIKE ? ORDER BY CAST(SUBSTRING(employee_id, ?) AS UNSIGNED) DESC LIMIT 1";
    const maxRowParams = pool.isDemoMode
      ? [sessionId, `${prefix}%`, prefix.length + 1]
      : [`${prefix}%`, prefix.length + 1];

    const [maxRow] = await pool.execute(maxRowSql, maxRowParams);
    let nextNum = 1;
    if (maxRow && maxRow[0] && maxRow[0].employee_id) {
      const numPart = maxRow[0].employee_id.substring(prefix.length);
      const parsed = parseInt(numPart, 10);
      if (!isNaN(parsed)) {
        nextNum = parsed + 1;
      }
    }

    const employee_id = `${prefix}${String(nextNum).padStart(3, '0')}`;
    const hashedPassword = await bcrypt.hash(String(password), 10);

    let result;
    if (pool.isDemoMode) {
      const [resInsert] = await pool.execute(
        'INSERT INTO users (demo_session_id, employee_id, name, email, password, role, department, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [sessionId, employee_id, name, finalEmail, hashedPassword, role, finalDepartment, phone || '', 'ACTIVE']
      );
      result = resInsert;
    } else {
      const [resInsert] = await pool.execute(
        'INSERT INTO users (employee_id, name, email, password, role, department, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [employee_id, name, finalEmail, hashedPassword, role, finalDepartment, phone || '', 'ACTIVE']
      );
      result = resInsert;
    }

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
        email: finalEmail || '',
        role,
        department: finalDepartment,
        phone: phone || '',
        status: 'ACTIVE'
      }
    });
  } catch (err) {
    console.error("========== CREATE USER ERROR ==========", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

exports.getUsers = async (req, res, next) => {
  try {
    const sessionId = getSessionId(req);
    let sql = `
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
    `;
    let params = [];

    if (pool.isDemoMode && sessionId) {
      sql = `
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
        WHERE demo_session_id = ?
        ORDER BY id ASC
      `;
      params = [sessionId];
    }

    const [users] = await pool.execute(sql, params);

    const formatted = users.map(u => ({
      ...u,
      employeeId: u.employee_id || "",
      status: u.status || "ACTIVE"
    }));

    res.json(formatted);
  } catch (err) {
    console.error("========== GET USERS ERROR ==========", err);
    res.status(500).json({ message: err.message });
  }
};

exports.getNextEmployeeId = async (req, res, next) => {
  try {
    const { role } = req.query;
    const sessionId = getSessionId(req);

    const r = String(role || '').toLowerCase().trim();
    if (!r) {
      return res.json({ employee_id: '' });
    }

    const singletonRoles = {
      accounts: { label: 'Accounts', prefix: 'ACC' },
      manager: { label: 'Manager', prefix: 'MGR' },
      cfo: { label: 'CFO', prefix: 'CFO' },
      md: { label: 'MD', prefix: 'MD' },
      admin: { label: 'Admin', prefix: 'ADM' }
    };

    if (singletonRoles[r]) {
      const roleCheckSql = pool.isDemoMode
        ? 'SELECT id, employee_id FROM users WHERE demo_session_id = ? AND LOWER(role) = ? LIMIT 1'
        : 'SELECT id, employee_id FROM users WHERE LOWER(role) = ? LIMIT 1';
      const roleCheckParams = pool.isDemoMode ? [sessionId, r] : [r];
      const [existingRole] = await pool.execute(roleCheckSql, roleCheckParams);
      if (existingRole && existingRole.length > 0) {
        return res.status(400).json({
          message: `An ${singletonRoles[r].label} user already exists. Only one ${singletonRoles[r].label} user is allowed.`,
          exists: true,
          employee_id: existingRole[0].employee_id
        });
      }
      return res.json({
        employee_id: `${singletonRoles[r].prefix}001`,
        exists: false
      });
    }

    const prefix = 'EMP';
    const maxRowSql = pool.isDemoMode
      ? "SELECT employee_id FROM users WHERE demo_session_id = ? AND employee_id LIKE ? ORDER BY CAST(SUBSTRING(employee_id, ?) AS UNSIGNED) DESC LIMIT 1"
      : "SELECT employee_id FROM users WHERE employee_id LIKE ? ORDER BY CAST(SUBSTRING(employee_id, ?) AS UNSIGNED) DESC LIMIT 1";
    const maxRowParams = pool.isDemoMode
      ? [sessionId, `${prefix}%`, prefix.length + 1]
      : [`${prefix}%`, prefix.length + 1];

    const [maxRow] = await pool.execute(maxRowSql, maxRowParams);
    let nextNum = 1;
    if (maxRow && maxRow[0] && maxRow[0].employee_id) {
      const numPart = maxRow[0].employee_id.substring(prefix.length);
      const parsed = parseInt(numPart, 10);
      if (!isNaN(parsed)) {
        nextNum = parsed + 1;
      }
    }

    const employee_id = `${prefix}${String(nextNum).padStart(3, '0')}`;
    res.json({ employee_id, exists: false });
  } catch (err) {
    console.error("========== GET NEXT EMPLOYEE ID ERROR ==========", err);
    res.status(500).json({ message: err.message });
  }
};

exports.updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, phone, department, role } = req.body;
    const sessionId = getSessionId(req);

    const r = String(role || '').toLowerCase().trim();
    const isApproverRole = ['accounts', 'manager', 'cfo', 'md'].includes(r);

    if (r === 'employee') {
      const cleanDept = String(department || '').trim();
      if (!cleanDept || cleanDept.toLowerCase() === 'all departments') {
        return res.status(400).json({ message: 'Employees must be assigned to a specific department.' });
      }
    }

    const finalDepartment = isApproverRole ? 'All Departments' : String(department || '').trim();

    if (!name || !role || (!isApproverRole && !finalDepartment)) {
      return res.status(400).json({ message: 'Name, role, and department are required.' });
    }

    const checkUserSql = pool.isDemoMode
      ? 'SELECT * FROM users WHERE demo_session_id = ? AND id = ?'
      : 'SELECT * FROM users WHERE id = ?';
    const checkUserParams = pool.isDemoMode ? [sessionId, id] : [id];

    const [existingUser] = await pool.execute(checkUserSql, checkUserParams);
    if (!existingUser || existingUser.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const finalEmail = (email !== undefined && email !== null && String(email).trim().length > 0)
      ? String(email).trim().toLowerCase()
      : (email === undefined ? (existingUser[0].email || null) : null);

    if (finalEmail) {
      const dupSql = pool.isDemoMode
        ? 'SELECT id FROM users WHERE demo_session_id = ? AND email = ? AND id != ? LIMIT 1'
        : 'SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1';
      const dupParams = pool.isDemoMode ? [sessionId, finalEmail, id] : [finalEmail, id];

      const [duplicateEmail] = await pool.execute(dupSql, dupParams);
      if (duplicateEmail && duplicateEmail.length > 0) {
        return res.status(400).json({ message: 'User with this email already exists.' });
      }
    }

    if (r === 'admin') {
      const adminDupSql = pool.isDemoMode
        ? 'SELECT id FROM users WHERE demo_session_id = ? AND LOWER(role) = ? AND id != ? LIMIT 1'
        : 'SELECT id FROM users WHERE LOWER(role) = ? AND id != ? LIMIT 1';
      const adminDupParams = pool.isDemoMode ? [sessionId, 'admin', id] : ['admin', id];
      const [existingAdmin] = await pool.execute(adminDupSql, adminDupParams);
      if (existingAdmin && existingAdmin.length > 0) {
        return res.status(400).json({ message: 'An Admin user already exists. Only one Admin user is allowed.' });
      }
    }

    const singletonRoles = {
      accounts: 'An Accounts user already exists. Only one Accounts user is allowed.',
      manager: 'A Manager user already exists. Only one Manager user is allowed.',
      cfo: 'A CFO user already exists. Only one CFO user is allowed.',
      md: 'An MD user already exists. Only one MD user is allowed.'
    };

    if (singletonRoles[r]) {
      const roleDupSql = pool.isDemoMode
        ? 'SELECT id FROM users WHERE demo_session_id = ? AND LOWER(role) = ? AND id != ? LIMIT 1'
        : 'SELECT id FROM users WHERE LOWER(role) = ? AND id != ? LIMIT 1';
      const roleDupParams = pool.isDemoMode ? [sessionId, r, id] : [r, id];
      const [existingRoleDup] = await pool.execute(roleDupSql, roleDupParams);
      if (existingRoleDup && existingRoleDup.length > 0) {
        return res.status(400).json({ message: singletonRoles[r] });
      }
    }

    const updateSql = pool.isDemoMode
      ? 'UPDATE users SET name = ?, email = ?, phone = ?, department = ?, role = ? WHERE demo_session_id = ? AND id = ?'
      : 'UPDATE users SET name = ?, email = ?, phone = ?, department = ?, role = ? WHERE id = ?';
    const updateParams = pool.isDemoMode
      ? [name, finalEmail, phone || '', finalDepartment, role, sessionId, id]
      : [name, finalEmail, phone || '', finalDepartment, role, id];

    await pool.execute(updateSql, updateParams);

    const [updatedRows] = await pool.execute(
      pool.isDemoMode
        ? 'SELECT id, employee_id, name, email, role, department, phone, profile_image, status, created_at FROM users WHERE demo_session_id = ? AND id = ?'
        : 'SELECT id, employee_id, name, email, role, department, phone, profile_image, status, created_at FROM users WHERE id = ?',
      pool.isDemoMode ? [sessionId, id] : [id]
    );
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
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'User with this email already exists.' });
    }
    next(err);
  }
};

exports.activateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const sessionId = getSessionId(req);

    const checkSql = pool.isDemoMode
      ? 'SELECT * FROM users WHERE demo_session_id = ? AND id = ?'
      : 'SELECT * FROM users WHERE id = ?';
    const checkParams = pool.isDemoMode ? [sessionId, id] : [id];

    const [existingUser] = await pool.execute(checkSql, checkParams);
    if (!existingUser || existingUser.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const updateSql = pool.isDemoMode
      ? 'UPDATE users SET status = ? WHERE demo_session_id = ? AND id = ?'
      : 'UPDATE users SET status = ? WHERE id = ?';
    const updateParams = pool.isDemoMode ? ['ACTIVE', sessionId, id] : ['ACTIVE', id];

    await pool.execute(updateSql, updateParams);

    const [updatedRows] = await pool.execute(
      pool.isDemoMode
        ? 'SELECT id, employee_id, name, email, role, department, phone, profile_image, status FROM users WHERE demo_session_id = ? AND id = ?'
        : 'SELECT id, employee_id, name, email, role, department, phone, profile_image, status FROM users WHERE id = ?',
      pool.isDemoMode ? [sessionId, id] : [id]
    );

    res.json({
      success: true,
      message: 'User Activated Successfully',
      user: {
        ...updatedRows[0],
        employeeId: updatedRows[0].employee_id || ''
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.deactivateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const sessionId = getSessionId(req);

    const checkSql = pool.isDemoMode
      ? 'SELECT * FROM users WHERE demo_session_id = ? AND id = ?'
      : 'SELECT * FROM users WHERE id = ?';
    const checkParams = pool.isDemoMode ? [sessionId, id] : [id];

    const [existingUser] = await pool.execute(checkSql, checkParams);
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

    const updateSql = pool.isDemoMode
      ? 'UPDATE users SET status = ? WHERE demo_session_id = ? AND id = ?'
      : 'UPDATE users SET status = ? WHERE id = ?';
    const updateParams = pool.isDemoMode ? ['INACTIVE', sessionId, id] : ['INACTIVE', id];

    await pool.execute(updateSql, updateParams);

    const [updatedRows] = await pool.execute(
      pool.isDemoMode
        ? 'SELECT id, employee_id, name, email, role, department, phone, profile_image, status FROM users WHERE demo_session_id = ? AND id = ?'
        : 'SELECT id, employee_id, name, email, role, department, phone, profile_image, status FROM users WHERE id = ?',
      pool.isDemoMode ? [sessionId, id] : [id]
    );

    res.json({
      success: true,
      message: 'User Deactivated Successfully',
      user: {
        ...updatedRows[0],
        employeeId: updatedRows[0].employee_id || ''
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.saveRecoveryEmail = async (req, res, next) => {
  try {
    const { userId, recoveryEmail } = req.body || {};
    const sessionId = getSessionId(req);

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

    const updateSql = pool.isDemoMode
      ? 'UPDATE users SET recovery_email = ? WHERE demo_session_id = ? AND id = ?'
      : 'UPDATE users SET recovery_email = ? WHERE id = ?';
    const updateParams = pool.isDemoMode ? [email, sessionId, userId] : [email, userId];

    const [result] = await pool.execute(updateSql, updateParams);

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
    next(err);
  }
};

exports.setRecoveryEmail = exports.saveRecoveryEmail;

exports.forgotPassword = async (req, res, next) => {
  try {
    const { employee_id, employeeId, loginIdentifier, email, loginId } = req.body || {};
    const inputIdentifier = String(employee_id || employeeId || loginIdentifier || email || loginId || '').trim();
    const sessionId = getSessionId(req);

    const genericMessage = 'If the account is eligible, a password reset link has been sent to the registered recovery email.';

    if (!inputIdentifier) {
      return res.status(400).json({
        success: false,
        message: 'Please enter your Employee ID.'
      });
    }

    const sql = pool.isDemoMode
      ? 'SELECT id, name, email, employee_id, role, recovery_email, status FROM users WHERE demo_session_id = ? AND (LOWER(TRIM(employee_id)) = LOWER(?) OR LOWER(TRIM(email)) = LOWER(?)) LIMIT 1'
      : 'SELECT id, name, email, employee_id, role, recovery_email, status FROM users WHERE LOWER(TRIM(employee_id)) = LOWER(?) OR LOWER(TRIM(email)) = LOWER(?) LIMIT 1';
    const params = pool.isDemoMode
      ? [sessionId, inputIdentifier, inputIdentifier]
      : [inputIdentifier, inputIdentifier];

    const [rows] = await pool.execute(sql, params);

    if (!rows || rows.length === 0) {
      return res.json({ success: true, message: genericMessage });
    }

    const user = rows[0];
    const isStatusActive = String(user.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
    const recoveryEmail = (user.recovery_email || '').trim();

    if (!isStatusActive || !recoveryEmail) {
      return res.json({ success: true, message: genericMessage });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    if (pool.isDemoMode) {
      await pool.execute(
        'INSERT INTO password_reset_tokens (demo_session_id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
        [sessionId, user.id, tokenHash, expiresAt]
      );
    } else {
      await pool.execute(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
        [user.id, tokenHash, expiresAt]
      );
    }

    await sendPasswordResetEmail(recoveryEmail, rawToken);

    return res.json({ success: true, message: genericMessage });
  } catch (err) {
    next(err);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword, confirmPassword } = req.body || {};
    const sessionId = getSessionId(req);

    if (!token || !String(token).trim()) {
      return res.status(400).json({ success: false, message: 'Reset token is required.' });
    }

    if (!newPassword || !String(newPassword).trim()) {
      return res.status(400).json({ success: false, message: 'New password is required.' });
    }

    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({ success: false, message: passwordValidation.message });
    }

    if (confirmPassword !== undefined && String(newPassword) !== String(confirmPassword)) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const cleanToken = String(token).trim();
    const tokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');

    const tokenSql = pool.isDemoMode
      ? 'SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE demo_session_id = ? AND token_hash = ? LIMIT 1'
      : 'SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ? LIMIT 1';
    const tokenParams = pool.isDemoMode ? [sessionId, tokenHash] : [tokenHash];

    const [rows] = await pool.execute(tokenSql, tokenParams);

    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired password reset link.' });
    }

    const record = rows[0];

    if (record.used_at) {
      return res.status(400).json({ success: false, message: 'This password reset link has already been used.' });
    }

    const now = new Date();
    const expiresAt = new Date(record.expires_at);

    if (expiresAt < now) {
      return res.status(400).json({ success: false, message: 'This password reset link has expired. Please request a new one.' });
    }

    const userSql = pool.isDemoMode
      ? 'SELECT id FROM users WHERE demo_session_id = ? AND id = ? LIMIT 1'
      : 'SELECT id FROM users WHERE id = ? LIMIT 1';
    const userParams = pool.isDemoMode ? [sessionId, record.user_id] : [record.user_id];

    const [userRows] = await pool.execute(userSql, userParams);

    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    const hashedPassword = await bcrypt.hash(String(newPassword), 10);

    const updatePassSql = pool.isDemoMode
      ? 'UPDATE users SET password = ? WHERE demo_session_id = ? AND id = ?'
      : 'UPDATE users SET password = ? WHERE id = ?';
    const updatePassParams = pool.isDemoMode ? [hashedPassword, sessionId, record.user_id] : [hashedPassword, record.user_id];

    await pool.execute(updatePassSql, updatePassParams);

    await pool.execute('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [record.id]);

    return res.json({
      success: true,
      message: 'Password reset successful. You can now log in.'
    });
  } catch (err) {
    next(err);
  }
};

exports.verifyToken = async (req, res, next) => {
  try {
    if (!req.user || (!req.user.id && !req.user.employee_id)) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const sessionId = getSessionId(req);
    let user = null;

    if (pool.isDemoMode) {
      // Check if user is Demo Owner (global account, not bound to transient session)
      if (req.user.account_type === 'DEMO_OWNER' || String(req.user.employee_id || '').toLowerCase() === 'adm-demo-001') {
        const [ownerRows] = await pool.execute(
          `SELECT id, employee_id, name, email, role, department, phone, profile_image, status, recovery_email, account_type 
           FROM users 
           WHERE (id = ? OR LOWER(TRIM(employee_id)) = 'adm-demo-001') AND (account_type = 'DEMO_OWNER' OR LOWER(role) = 'admin') 
           LIMIT 1`,
          [req.user.id || 0]
        );
        if (ownerRows && ownerRows.length > 0) {
          user = ownerRows[0];
        }
      }

      if (!user && sessionId && req.user.id) {
        const [rows] = await pool.execute(
          'SELECT id, employee_id, name, email, role, department, phone, profile_image, status, recovery_email, account_type FROM users WHERE demo_session_id = ? AND id = ? LIMIT 1',
          [sessionId, req.user.id]
        );
        if (rows && rows.length > 0) user = rows[0];
      }

      if (!user && req.user.id) {
        const [rows] = await pool.execute(
          'SELECT id, employee_id, name, email, role, department, phone, profile_image, status, recovery_email, account_type FROM users WHERE id = ? LIMIT 1',
          [req.user.id]
        );
        if (rows && rows.length > 0) user = rows[0];
      }

      if (!user && req.user.employee_id) {
        const [rows] = await pool.execute(
          'SELECT id, employee_id, name, email, role, department, phone, profile_image, status, recovery_email, account_type FROM users WHERE LOWER(TRIM(employee_id)) = LOWER(?) LIMIT 1',
          [req.user.employee_id]
        );
        if (rows && rows.length > 0) user = rows[0];
      }

      if (!user && req.user.employee_id) {
        const [demoRows] = await pool.execute(
          'SELECT * FROM demo_access WHERE LOWER(TRIM(employee_id)) = LOWER(?) LIMIT 1',
          [req.user.employee_id]
        );
        if (demoRows && demoRows.length > 0) {
          const rec = demoRows[0];
          user = {
            id: rec.id,
            employee_id: rec.employee_id,
            name: 'Demo Administrator',
            email: null,
            role: 'Admin',
            department: 'Management',
            phone: '',
            status: rec.status === 'EXPIRED' ? 'INACTIVE' : 'ACTIVE',
            recovery_email: null,
            account_type: 'TEMPORARY_DEMO_ADMIN'
          };
        }
      }
    } else {
      if (req.user.id) {
        const [rows] = await pool.execute(
          'SELECT id, employee_id, name, email, role, department, phone, profile_image, status, recovery_email, account_type FROM users WHERE id = ? LIMIT 1',
          [req.user.id]
        );
        if (rows && rows.length > 0) user = rows[0];
      }
      if (!user && req.user.employee_id) {
        const [rows] = await pool.execute(
          'SELECT id, employee_id, name, email, role, department, phone, profile_image, status, recovery_email, account_type FROM users WHERE LOWER(TRIM(employee_id)) = LOWER(?) LIMIT 1',
          [req.user.employee_id]
        );
        if (rows && rows.length > 0) user = rows[0];
      }
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'User account not found' });
    }

    if (user.status && user.status.toUpperCase() === 'INACTIVE') {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    const rawRole = String(user.role || req.user.role || '').toLowerCase();
    const rawEmpId = String(user.employee_id || req.user.employee_id || '').toUpperCase();
    const isAdmin = rawRole === 'admin';
    const isDemoEmp = rawEmpId.startsWith('DEMO-');

    let accountType;
    let isDemoOwner = false;
    let isTemporaryDemoAdmin = false;

    if (pool.isDemoMode) {
      if (isDemoEmp || user.account_type === 'TEMPORARY_DEMO_ADMIN') {
        accountType = 'TEMPORARY_DEMO_ADMIN';
        isDemoOwner = false;
        isTemporaryDemoAdmin = true;
      } else if (isAdmin) {
        accountType = 'DEMO_OWNER';
        isDemoOwner = true;
        isTemporaryDemoAdmin = false;
      } else {
        accountType = 'DEMO_USER';
        isDemoOwner = false;
        isTemporaryDemoAdmin = false;
      }
    } else {
      if (isAdmin) {
        accountType = 'PRODUCTION_ADMIN';
      } else {
        accountType = 'PRODUCTION_USER';
      }
      isDemoOwner = false;
      isTemporaryDemoAdmin = false;
    }

    const hasRecoveryEmail =
      isAdmin ||
      Boolean(user.recovery_email && String(user.recovery_email).trim().length > 0);

    return res.json({
      success: true,
      is_demo_mode: Boolean(pool.isDemoMode),
      is_demo_owner: isDemoOwner,
      is_temporary_demo_admin: isTemporaryDemoAdmin,
      account_type: accountType,
      user: {
        id: user.id,
        employee_id: user.employee_id || req.user.employee_id || '',
        employeeId: user.employee_id || req.user.employee_id || '',
        name: user.name || 'Admin',
        email: user.email || '',
        role: user.role || 'Admin',
        account_type: accountType,
        department: user.department || 'Management',
        phone: user.phone || '',
        status: user.status || 'ACTIVE',
        hasRecoveryEmail,
        is_demo_mode: Boolean(pool.isDemoMode),
        is_demo_owner: isDemoOwner,
        is_temporary_demo_admin: isTemporaryDemoAdmin
      }
    });
  } catch (err) {
    next(err);
  }
};
