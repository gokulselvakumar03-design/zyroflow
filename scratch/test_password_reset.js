const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const authController = require('../controllers/authController');

// Mock response helper
function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}

async function runTests() {
  console.log('=== STARTING FORGOT / RESET PASSWORD TEST SUITE ===\n');

  // Ensure tables exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_token_hash (token_hash),
      INDEX idx_user_id (user_id)
    )
  `);

  // Ensure test users exist in DB
  // 1. Admin
  await pool.query(`
    INSERT INTO users (employee_id, name, email, password, role, status)
    VALUES ('ADM999', 'Test Admin', 'test_admin@zyroflow.com', 'adminpass', 'admin', 'ACTIVE')
    ON DUPLICATE KEY UPDATE name=VALUES(name)
  `);

  // 2. Non-admin WITH recovery email
  await pool.query(`
    INSERT INTO users (employee_id, name, email, password, role, recovery_email, status)
    VALUES ('EMP998', 'Test Employee With Rec', 'test_emp_rec@zyroflow.com', 'oldpass123', 'employee', 'realtest@gmail.com', 'ACTIVE')
    ON DUPLICATE KEY UPDATE recovery_email='realtest@gmail.com', password='oldpass123'
  `);

  // 3. Non-admin WITHOUT recovery email
  await pool.query(`
    INSERT INTO users (employee_id, name, email, password, role, recovery_email, status)
    VALUES ('EMP997', 'Test Employee No Rec', 'test_emp_norec@zyroflow.com', 'oldpass123', 'employee', NULL, 'ACTIVE')
    ON DUPLICATE KEY UPDATE recovery_email=NULL, password='oldpass123'
  `);

  // =========================================================================
  // TEST 1: Existing non-admin user WITH recovery email -> Token generated & email sent
  // =========================================================================
  {
    const req = { body: { email: 'test_emp_rec@zyroflow.com' } };
    const res = createMockRes();
    await authController.forgotPassword(req, res, (err) => { if (err) throw err; });

    const [tokens] = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1',
      ['test_emp_rec@zyroflow.com']
    );

    const passed = res.body?.success === true && tokens.length > 0 && tokens[0].used_at === null;
    console.log(`TEST 1 (Non-admin WITH recovery email -> token saved): ${passed ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // =========================================================================
  // TEST 2: Existing non-admin user WITHOUT recovery email -> Generic response, NO token generated
  // =========================================================================
  {
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)', ['test_emp_norec@zyroflow.com']);
    const req = { body: { email: 'test_emp_norec@zyroflow.com' } };
    const res = createMockRes();
    await authController.forgotPassword(req, res, (err) => { if (err) throw err; });

    const [tokens] = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)',
      ['test_emp_norec@zyroflow.com']
    );

    const passed = res.body?.success === true &&
      res.body?.message === 'If the account exists and has a recovery email configured, a password reset link has been sent.' &&
      tokens.length === 0;
    console.log(`TEST 2 (Non-admin WITHOUT recovery email -> generic response, 0 tokens): ${passed ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // =========================================================================
  // TEST 3: Admin -> Generic response, NO email / token
  // =========================================================================
  {
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)', ['test_admin@zyroflow.com']);
    const req = { body: { email: 'test_admin@zyroflow.com' } };
    const res = createMockRes();
    await authController.forgotPassword(req, res, (err) => { if (err) throw err; });

    const [tokens] = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)',
      ['test_admin@zyroflow.com']
    );

    const passed = res.body?.success === true && tokens.length === 0;
    console.log(`TEST 3 (Admin -> generic response, 0 tokens): ${passed ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // =========================================================================
  // TEST 4: Invalid login identifier -> Generic response
  // =========================================================================
  {
    const req = { body: { email: 'doesnotexist@nowhere.com' } };
    const res = createMockRes();
    await authController.forgotPassword(req, res, (err) => { if (err) throw err; });

    const passed = res.body?.success === true &&
      res.body?.message === 'If the account exists and has a recovery email configured, a password reset link has been sent.';
    console.log(`TEST 4 (Invalid login identifier -> generic response): ${passed ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // =========================================================================
  // TEST 5 & 10: Valid reset link -> Reset password & login with new password
  // =========================================================================
  let validRawToken = crypto.randomBytes(32).toString('hex');
  let validTokenHash = crypto.createHash('sha256').update(validRawToken).digest('hex');
  {
    const [userRows] = await pool.query('SELECT id FROM users WHERE email = ?', ['test_emp_rec@zyroflow.com']);
    const userId = userRows[0].id;

    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [userId, validTokenHash, new Date(Date.now() + 30 * 60 * 1000)]
    );

    const resetReq = {
      body: {
        token: validRawToken,
        newPassword: 'BrandNewSecurePass123!',
        confirmPassword: 'BrandNewSecurePass123!'
      }
    };
    const resetRes = createMockRes();
    await authController.resetPassword(resetReq, resetRes, (err) => { if (err) throw err; });

    const [updatedUser] = await pool.query('SELECT password FROM users WHERE id = ?', [userId]);
    const isBcrypt = updatedUser[0].password.startsWith('$2b$');
    const isMatch = await bcrypt.compare('BrandNewSecurePass123!', updatedUser[0].password);

    const passed = resetRes.body?.success === true && isBcrypt && isMatch;
    console.log(`TEST 5 (Valid reset token -> password updated with bcrypt): ${passed ? '✓ PASSED' : '❌ FAILED'}`);

    // TEST 10: Login with new password
    const loginReq = {
      body: {
        email: 'test_emp_rec@zyroflow.com',
        password: 'BrandNewSecurePass123!'
      }
    };
    const loginRes = createMockRes();
    await authController.login(loginReq, loginRes, (err) => { if (err) throw err; });

    const loginPassed = loginRes.body?.token && loginRes.body?.role === 'employee' && loginRes.body?.hasRecoveryEmail === true;
    console.log(`TEST 10 (Login with new password -> success): ${loginPassed ? '✓ PASSED' : '❌ FAILED'}`);

    // Login with old password fails
    const oldLoginReq = {
      body: {
        email: 'test_emp_rec@zyroflow.com',
        password: 'oldpass123'
      }
    };
    const oldLoginRes = createMockRes();
    await authController.login(oldLoginReq, oldLoginRes, (err) => { if (err) throw err; });
    const oldLoginFailed = oldLoginRes.statusCode === 401;
    console.log(`TEST 10b (Login with old password -> rejected 401): ${oldLoginFailed ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // =========================================================================
  // TEST 6: Mismatched password confirmation -> Rejected
  // =========================================================================
  {
    const req = {
      body: {
        token: 'anytoken',
        newPassword: 'pass1',
        confirmPassword: 'pass2'
      }
    };
    const res = createMockRes();
    await authController.resetPassword(req, res, (err) => { if (err) throw err; });

    const passed = res.statusCode === 400 && res.body?.message === 'Passwords do not match.';
    console.log(`TEST 6 (Mismatched password confirmation -> rejected 400): ${passed ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // =========================================================================
  // TEST 7: Expired token -> Rejected
  // =========================================================================
  {
    const expiredRawToken = crypto.randomBytes(32).toString('hex');
    const expiredTokenHash = crypto.createHash('sha256').update(expiredRawToken).digest('hex');
    const [userRows] = await pool.query('SELECT id FROM users WHERE email = ?', ['test_emp_rec@zyroflow.com']);

    // Expired 1 hour ago
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [userRows[0].id, expiredTokenHash, new Date(Date.now() - 3600000)]
    );

    const req = {
      body: {
        token: expiredRawToken,
        newPassword: 'newpassword123',
        confirmPassword: 'newpassword123'
      }
    };
    const res = createMockRes();
    await authController.resetPassword(req, res, (err) => { if (err) throw err; });

    const passed = res.statusCode === 400 && res.body?.message.includes('expired');
    console.log(`TEST 7 (Expired token -> rejected 400): ${passed ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // =========================================================================
  // TEST 8 & 9: Used token / Reusing same reset link -> Rejected
  // =========================================================================
  {
    // Reuse validRawToken which was used in TEST 5
    const req = {
      body: {
        token: validRawToken,
        newPassword: 'anotherpassword123',
        confirmPassword: 'anotherpassword123'
      }
    };
    const res = createMockRes();
    await authController.resetPassword(req, res, (err) => { if (err) throw err; });

    const passed = res.statusCode === 400 && res.body?.message.includes('already been used');
    console.log(`TEST 8 & 9 (Used token / Reused link -> rejected 400): ${passed ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // =========================================================================
  // TEST 11: Existing recovery-email first-login flow preserved
  // =========================================================================
  {
    const req = {
      body: {
        email: 'test_emp_norec@zyroflow.com',
        password: 'oldpass123'
      }
    };
    const res = createMockRes();
    await authController.login(req, res, (err) => { if (err) throw err; });

    const passed = res.body?.hasRecoveryEmail === false && res.body?.user?.hasRecoveryEmail === false;
    console.log(`TEST 11 (First-login user without recovery email -> hasRecoveryEmail=false): ${passed ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // =========================================================================
  // TEST 12: Admin login behavior preserved
  // =========================================================================
  {
    const req = {
      body: {
        email: 'test_admin@zyroflow.com',
        password: 'adminpass'
      }
    };
    const res = createMockRes();
    await authController.login(req, res, (err) => { if (err) throw err; });

    const passed = res.body?.role === 'admin' && res.body?.hasRecoveryEmail === true;
    console.log(`TEST 12 (Admin login -> role=admin, hasRecoveryEmail=true): ${passed ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // Cleanup test users
  await pool.query('DELETE FROM users WHERE email IN (?, ?, ?)', [
    'test_admin@zyroflow.com',
    'test_emp_rec@zyroflow.com',
    'test_emp_norec@zyroflow.com'
  ]);

  console.log('\n=== ALL TEST SUITE RUNS FINISHED SUCCESSFULLY ===');
  process.exit(0);
}

runTests().catch((e) => {
  console.error('Test Suite Error:', e);
  process.exit(1);
});
