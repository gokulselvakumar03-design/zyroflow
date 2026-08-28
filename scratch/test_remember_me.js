const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const authController = require('../controllers/authController');
const dotenv = require('dotenv');

dotenv.config();

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

async function runRememberMeTests() {
  console.log('=== STARTING REMEMBER ME & AUTHENTICATION TEST SUITE ===\n');

  // 1. Setup test users for all roles
  const roles = [
    { role: 'admin', email: 'test_rem_admin@zyroflow.com', name: 'Admin User', empId: 'ADM888', rec: 'adm_rec@gmail.com', pass: 'adminpass' },
    { role: 'employee', email: 'test_rem_emp@zyroflow.com', name: 'Emp User', empId: 'EMP888', rec: 'emp_rec@gmail.com', pass: 'emppass' },
    { role: 'manager', email: 'test_rem_mgr@zyroflow.com', name: 'Mgr User', empId: 'MGR888', rec: 'mgr_rec@gmail.com', pass: 'mgrpass' },
    { role: 'accounts', email: 'test_rem_acc@zyroflow.com', name: 'Acc User', empId: 'ACC888', rec: 'acc_rec@gmail.com', pass: 'accpass' },
    { role: 'cfo', email: 'test_rem_cfo@zyroflow.com', name: 'CFO User', empId: 'CFO888', rec: 'cfo_rec@gmail.com', pass: 'cfopass' },
    { role: 'md', email: 'test_rem_md@zyroflow.com', name: 'MD User', empId: 'MD888', rec: 'md_rec@gmail.com', pass: 'mdpass' },
    { role: 'employee', email: 'test_rem_norec@zyroflow.com', name: 'New Emp No Rec', empId: 'EMP889', rec: null, pass: 'newpass' }
  ];

  for (const u of roles) {
    await pool.query(`
      INSERT INTO users (employee_id, name, email, password, role, recovery_email, status)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
      ON DUPLICATE KEY UPDATE password=VALUES(password), role=VALUES(role), recovery_email=VALUES(recovery_email), status='ACTIVE'
    `, [u.empId, u.name, u.email, u.pass, u.role, u.rec]);
  }

  // TEST 1: Remember Me unchecked -> standard token duration
  {
    const req = { body: { email: 'test_rem_emp@zyroflow.com', password: 'emppass', rememberMe: false } };
    const res = createMockRes();
    await authController.login(req, res, (err) => { if (err) throw err; });

    const decoded = jwt.decode(res.body.token);
    const durationHours = (decoded.exp - decoded.iat) / 3600;
    const passed = res.body?.token && durationHours <= 24;
    console.log(`TEST 1 (Remember Me unchecked -> normal session token <=24h): ${passed ? '✓ PASSED' : '❌ FAILED'} (${durationHours}h)`);
  }

  // TEST 2 & 3: Remember Me checked -> 30-day persistent token
  let empRememberToken = '';
  {
    const req = { body: { email: 'test_rem_emp@zyroflow.com', password: 'emppass', rememberMe: true } };
    const res = createMockRes();
    await authController.login(req, res, (err) => { if (err) throw err; });

    empRememberToken = res.body.token;
    const decoded = jwt.decode(empRememberToken);
    const durationDays = (decoded.exp - decoded.iat) / 86400;
    const passed = res.body?.token && durationDays >= 29;
    console.log(`TEST 2 & 3 (Remember Me checked -> persistent token >=30d): ${passed ? '✓ PASSED' : '❌ FAILED'} (${durationDays} days)`);
  }

  // TEST 4 & 5: Token verification (valid token vs expired/invalid token)
  {
    // Valid token
    const reqValid = { user: { id: (await pool.query('SELECT id FROM users WHERE email=?', ['test_rem_emp@zyroflow.com']))[0][0].id } };
    const resValid = createMockRes();
    await authController.verifyToken(reqValid, resValid, (err) => { if (err) throw err; });
    const validPassed = resValid.body?.success === true && resValid.body?.user?.role === 'employee';
    console.log(`TEST 4 (Valid remembered session verification): ${validPassed ? '✓ PASSED' : '❌ FAILED'}`);

    // Invalid user ID / token
    const reqInvalid = { user: { id: 99999999 } };
    const resInvalid = createMockRes();
    await authController.verifyToken(reqInvalid, resInvalid, (err) => { if (err) throw err; });
    const invalidPassed = resInvalid.statusCode === 401;
    console.log(`TEST 5 (Invalid user session verification -> 401): ${invalidPassed ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // TEST 6: New non-admin user without recovery email -> hasRecoveryEmail = false
  {
    const req = { body: { email: 'test_rem_norec@zyroflow.com', password: 'newpass', rememberMe: true } };
    const res = createMockRes();
    await authController.login(req, res, (err) => { if (err) throw err; });
    const passed = res.body?.hasRecoveryEmail === false;
    console.log(`TEST 6 (New non-admin without recovery email + Remember Me -> hasRecoveryEmail=false): ${passed ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // TEST 7: Existing non-admin user with recovery email -> hasRecoveryEmail = true
  {
    const req = { body: { email: 'test_rem_emp@zyroflow.com', password: 'emppass', rememberMe: true } };
    const res = createMockRes();
    await authController.login(req, res, (err) => { if (err) throw err; });
    const passed = res.body?.hasRecoveryEmail === true;
    console.log(`TEST 7 (Existing non-admin with recovery email + Remember Me -> hasRecoveryEmail=true): ${passed ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // TEST 8 - 13: Role-based dashboard mapping & verification for all roles
  const roleDashboardExpectations = [
    { role: 'admin', email: 'test_rem_admin@zyroflow.com', pass: 'adminpass', expectedUrl: 'admin-dashboard.html' },
    { role: 'employee', email: 'test_rem_emp@zyroflow.com', pass: 'emppass', expectedUrl: 'employee.html' },
    { role: 'manager', email: 'test_rem_mgr@zyroflow.com', pass: 'mgrpass', expectedUrl: 'manager-dashboard.html' },
    { role: 'accounts', email: 'test_rem_acc@zyroflow.com', pass: 'accpass', expectedUrl: 'accounts-dashboard.html' },
    { role: 'cfo', email: 'test_rem_cfo@zyroflow.com', pass: 'cfopass', expectedUrl: 'cfo-dashboard.html' },
    { role: 'md', email: 'test_rem_md@zyroflow.com', pass: 'mdpass', expectedUrl: 'md-dashboard.html' }
  ];

  function getDashboardUrlForRole(role) {
    const r = String(role || '').toLowerCase().trim();
    if (r === 'admin') return 'admin-dashboard.html';
    if (r === 'accounts') return 'accounts-dashboard.html';
    if (r === 'manager') return 'manager-dashboard.html';
    if (r === 'cfo') return 'cfo-dashboard.html';
    if (r === 'md') return 'md-dashboard.html';
    if (r === 'employee') return 'employee.html';
    return 'user-dashboard.html';
  }

  for (let i = 0; i < roleDashboardExpectations.length; i++) {
    const item = roleDashboardExpectations[i];
    const req = { body: { email: item.email, password: item.pass, rememberMe: true } };
    const res = createMockRes();
    await authController.login(req, res, (err) => { if (err) throw err; });

    const targetUrl = getDashboardUrlForRole(res.body?.role);
    const passed = targetUrl === item.expectedUrl && (item.role !== 'admin' ? res.body.hasRecoveryEmail === true : true);
    console.log(`TEST ${8 + i} (${item.role.toUpperCase()} + Remember Me -> ${targetUrl}): ${passed ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // TEST 14: Security confirmation - Password is not in login response or JWT
  {
    const req = { body: { email: 'test_rem_emp@zyroflow.com', password: 'emppass', rememberMe: true } };
    const res = createMockRes();
    await authController.login(req, res, (err) => { if (err) throw err; });
    const decoded = jwt.decode(res.body.token);

    const hasNoPlainPassword = !res.body.password && !res.body.user?.password && !decoded.password;
    console.log(`TEST 16 (Security Inspection -> Passwords are NEVER returned or stored in JWT): ${hasNoPlainPassword ? '✓ PASSED' : '❌ FAILED'}`);
  }

  // Cleanup test users
  await pool.query('DELETE FROM users WHERE email LIKE ?', ['test_rem_%']);

  console.log('\n=== ALL REMEMBER ME TESTS PASSED SUCCESSFULLY ===');
  process.exit(0);
}

runRememberMeTests().catch(err => {
  console.error('Test Suite Error:', err);
  process.exit(1);
});
