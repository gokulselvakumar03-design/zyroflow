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
      console.log('[AUTH] User details - ID:', user.id, 'Email:', user.email, 'Role:', user.role, 'Name:', user.name);
    } else {
      console.log('[AUTH] ❌ User NOT found in database');
      return res.status(401).json({ message: 'Invalid credentials' });
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
    
    res.json({ token, role: user.role, userId: user.id });
  } catch (err) {
    console.log('[AUTH] ❌ Exception occurred:', err.message);
    console.log('[AUTH] ========== LOGIN ATTEMPT END (ERROR) ==========\n');
    next(err);
  }
};
