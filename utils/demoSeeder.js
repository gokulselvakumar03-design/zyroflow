/**
 * Demo Dataset Seeder
 * Populates a pristine, realistic dummy dataset for a specific demo_session_id.
 * Idempotent: Skips seeding if the session is already populated.
 */

const bcrypt = require('bcrypt');

async function seedDemoSession(pool, sessionId) {
  if (!sessionId) return;

  try {
    // Check if session is already initialized
    const [existingUsers] = await pool.query(
      'SELECT id FROM users WHERE demo_session_id = ? LIMIT 1',
      [sessionId]
    );

    if (existingUsers && existingUsers.length > 0) {
      return; // Already seeded
    }

    console.log(`[DEMO SEEDER] Seeding fresh workspace for demo session: ${sessionId}`);

    // Hash dummy passwords
    const hashedEmp = await bcrypt.hash('emp123', 10);
    const hashedMan = await bcrypt.hash('man123', 10);
    const hashedAcc = await bcrypt.hash('acc123', 10);
    const hashedCfo = await bcrypt.hash('cfo123', 10);
    const hashedMd = await bcrypt.hash('md123', 10);
    const hashedAdmin = await bcrypt.hash('admin123', 10);

    // 1. Seed Demo Users
    const users = [
      ['EMP001', 'Demo Employee', 'employee1@zyroflow.com', hashedEmp, 'employee', '+1 555-0101', 'Engineering', 'ACTIVE'],
      ['MGR001', 'Demo Manager', 'manager@zyroflow.com', hashedMan, 'manager', '+1 555-0102', 'All Departments', 'ACTIVE'],
      ['ACC001', 'Demo Accounts Officer', 'accounts@zyroflow.com', hashedAcc, 'accounts', '+1 555-0103', 'All Departments', 'ACTIVE'],
      ['CFO001', 'Demo CFO', 'cfo@zyroflow.com', hashedCfo, 'cfo', '+1 555-0104', 'All Departments', 'ACTIVE'],
      ['MD001', 'Demo MD', 'md@zyroflow.com', hashedMd, 'md', '+1 555-0105', 'All Departments', 'ACTIVE'],
      ['ADM001', 'Demo Admin', 'admin@zyroflow.com', hashedAdmin, 'admin', '+1 555-0100', 'Operations', 'ACTIVE'],
    ];

    for (const u of users) {
      await pool.query(
        `INSERT IGNORE INTO users (demo_session_id, employee_id, name, email, password, role, phone, department, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, u[0], u[1], u[2], u[3], u[4], u[5], u[6], u[7]]
      );
    }

    // 2. Seed Default Rules
    const rules = [
      ['General', 0, 50000, 'Accounts,Manager'],
      ['Financial', 50001, 200000, 'Accounts,Manager,CFO'],
      ['Executive Purchase', 200001, 1000000, 'Accounts,Manager,CFO,MD'],
      ['Travel', 0, 100000, 'Accounts,Manager,CFO'],
    ];

    for (const r of rules) {
      await pool.query(
        `INSERT INTO rules (demo_session_id, request_type, min_amount, max_amount, approvers)
         VALUES (?, ?, ?, ?, ?)`,
        [sessionId, r[0], r[1], r[2], r[3]]
      );
    }

    const defaultChain = JSON.stringify(['Accounts', 'Manager', 'CFO', 'MD']);

    // 3. Request 1: Pending Accounts Approval
    const [req1Res] = await pool.query(
      `INSERT INTO workflow_requests (
        demo_session_id, title, type, description, amount, department, priority, status,
        requester_name, requester_email, current_role, current_approver, approval_stage,
        workflow, payload, current_level, payment_verified, payment_verification_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        'Software License Renewal - JetBrains & Cloud Tools',
        'Software',
        'Annual subscription renewal for engineering IDEs, code analysis tools, and cloud developer environments.',
        45000,
        'Engineering',
        'HIGH',
        'Pending Accounts Approval',
        'Demo Employee',
        'employee1@zyroflow.com',
        'Accounts',
        'Accounts',
        'Accounts',
        defaultChain,
        JSON.stringify({ title: 'Software License Renewal - JetBrains & Cloud Tools', department: 'Engineering', priority: 'HIGH' }),
        0,
        0,
        'Unverified'
      ]
    );
    const req1Id = req1Res.insertId;

    await pool.query(
      `INSERT INTO approvals (demo_session_id, request_id, approver_role, step, status) VALUES
       (?, ?, 'Accounts', 0, 'pending'),
       (?, ?, 'Manager', 1, 'waiting'),
       (?, ?, 'CFO', 2, 'waiting'),
       (?, ?, 'MD', 3, 'waiting')`,
      [sessionId, req1Id, sessionId, req1Id, sessionId, req1Id, sessionId, req1Id]
    );

    await pool.query(
      `INSERT INTO request_history (demo_session_id, request_id, action, performed_by) VALUES
       (?, ?, 'Created request', 'Demo Employee')`,
      [sessionId, req1Id]
    );

    await pool.query(
      `INSERT INTO notifications (demo_session_id, user_email, user_role, request_id, title, message, type) VALUES
       (?, 'employee1@zyroflow.com', 'employee', ?, 'Request Submitted', 'Software license renewal submitted successfully.', 'success'),
       (?, NULL, 'accounts', ?, 'New Request', 'New financial request waiting for verification.', 'info')`,
      [sessionId, req1Id, sessionId, req1Id]
    );

    // 4. Request 2: Fully Approved
    const [req2Res] = await pool.query(
      `INSERT INTO workflow_requests (
        demo_session_id, title, type, description, amount, department, priority, status,
        requester_name, requester_email, current_role, current_approver, approval_stage,
        workflow, payload, current_level, payment_verified, payment_verified_by, payment_verified_at, payment_verification_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        sessionId,
        'Office Workstation & Monitor Upgrade',
        'Hardware',
        'Dual-monitor workstations and ergonomic peripherals for developer productivity.',
        120000,
        'Engineering',
        'MEDIUM',
        'Approved',
        'Demo Employee',
        'employee1@zyroflow.com',
        'Completed',
        'Completed',
        'Completed',
        defaultChain,
        JSON.stringify({ title: 'Office Workstation & Monitor Upgrade', department: 'Engineering', priority: 'MEDIUM' }),
        4,
        1,
        'Demo Accounts Officer',
        'Verified'
      ]
    );
    const req2Id = req2Res.insertId;

    await pool.query(
      `INSERT INTO approvals (demo_session_id, request_id, approver_role, step, status, comments) VALUES
       (?, ?, 'Accounts', 0, 'approved', 'Payment verification complete.'),
       (?, ?, 'Manager', 1, 'approved', 'Hardware specifications approved.'),
       (?, ?, 'CFO', 2, 'approved', 'Approved within Q3 budget allocation.'),
       (?, ?, 'MD', 3, 'approved', 'Final signoff approved.')`,
      [sessionId, req2Id, sessionId, req2Id, sessionId, req2Id, sessionId, req2Id]
    );

    await pool.query(
      `INSERT INTO request_history (demo_session_id, request_id, action, performed_by) VALUES
       (?, ?, 'Created request', 'Demo Employee'),
       (?, ?, 'Payment Verified', 'Demo Accounts Officer'),
       (?, ?, 'APPROVED by Accounts', 'Demo Accounts Officer'),
       (?, ?, 'APPROVED by Manager', 'Demo Manager'),
       (?, ?, 'APPROVED by CFO', 'Demo CFO'),
       (?, ?, 'APPROVED by MD', 'Demo MD')`,
      [sessionId, req2Id, sessionId, req2Id, sessionId, req2Id, sessionId, req2Id, sessionId, req2Id, sessionId, req2Id]
    );

    await pool.query(
      `INSERT INTO approval_history (demo_session_id, request_id, employee_name, department, request_type, manager_name, approval_stage, decision, action, decision_time_seconds, comments) VALUES
       (?, ?, 'Demo Employee', 'Engineering', 'Hardware', 'Demo Accounts Officer', 'Accounts', 'Approved', 'Approved', 120, 'Payment verified'),
       (?, ?, 'Demo Employee', 'Engineering', 'Hardware', 'Demo Manager', 'Manager', 'Approved', 'Approved', 240, 'Specifications approved'),
       (?, ?, 'Demo Employee', 'Engineering', 'Hardware', 'Demo CFO', 'CFO', 'Approved', 'Approved', 360, 'Budget cleared'),
       (?, ?, 'Demo Employee', 'Engineering', 'Hardware', 'Demo MD', 'MD', 'Approved', 'Approved', 480, 'Approved')`,
      [sessionId, req2Id, sessionId, req2Id, sessionId, req2Id, sessionId, req2Id]
    );

    await pool.query(
      `INSERT INTO payment_verifications (demo_session_id, request_id, verified_by, remarks, status) VALUES
       (?, ?, 'Demo Accounts Officer', 'Vendor invoice INV-2026-0002 verified against IT hardware budget.', 'Verified')`,
      [sessionId, req2Id]
    );

    await pool.query(
      `INSERT INTO notifications (demo_session_id, user_email, user_role, request_id, title, message, type) VALUES
       (?, 'employee1@zyroflow.com', 'employee', ?, 'Request Approved', 'Your workstation upgrade has been fully approved by MD.', 'success')`,
      [sessionId, req2Id]
    );

    // 5. Request 3: Rejected by CFO
    const [req3Res] = await pool.query(
      `INSERT INTO workflow_requests (
        demo_session_id, title, type, description, amount, department, priority, status,
        requester_name, requester_email, current_role, current_approver, approval_stage,
        workflow, payload, current_level, payment_verified, rejection_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        'Annual Team Offsite & Travel Allowance',
        'Travel',
        'Offsite workshop expenses, travel accommodation, and venue booking.',
        250000,
        'Engineering',
        'LOW',
        'Rejected',
        'Demo Employee',
        'employee1@zyroflow.com',
        'CFO',
        'CFO',
        'CFO',
        defaultChain,
        JSON.stringify({ title: 'Annual Team Offsite & Travel Allowance', department: 'Engineering', priority: 'LOW' }),
        2,
        0,
        'Budget limit exceeded for Q3 travel expenses. Please revise and resubmit for Q4.'
      ]
    );
    const req3Id = req3Res.insertId;

    await pool.query(
      `INSERT INTO approvals (demo_session_id, request_id, approver_role, step, status, comments) VALUES
       (?, ?, 'Accounts', 0, 'approved', 'Documents reviewed.'),
       (?, ?, 'Manager', 1, 'approved', 'Team schedule cleared.'),
       (?, ?, 'CFO', 2, 'rejected', 'Budget limit exceeded for Q3 travel expenses.'),
       (?, ?, 'MD', 3, 'waiting', NULL)`,
      [sessionId, req3Id, sessionId, req3Id, sessionId, req3Id, sessionId, req3Id]
    );

    await pool.query(
      `INSERT INTO request_history (demo_session_id, request_id, action, performed_by, comments) VALUES
       (?, ?, 'Created request', 'Demo Employee', NULL),
       (?, ?, 'APPROVED by Accounts', 'Demo Accounts Officer', 'Documents reviewed'),
       (?, ?, 'APPROVED by Manager', 'Demo Manager', 'Team schedule cleared'),
       (?, ?, 'REJECTED by CFO', 'Demo CFO', 'Budget limit exceeded for Q3 travel expenses.')`,
      [sessionId, req3Id, sessionId, req3Id, sessionId, req3Id, sessionId, req3Id]
    );

    await pool.query(
      `INSERT INTO approval_history (demo_session_id, request_id, employee_name, department, request_type, manager_name, approval_stage, decision, action, decision_time_seconds, comments) VALUES
       (?, ?, 'Demo Employee', 'Engineering', 'Travel', 'Demo Accounts Officer', 'Accounts', 'Approved', 'Approved', 180, 'Documents reviewed'),
       (?, ?, 'Demo Employee', 'Engineering', 'Travel', 'Demo Manager', 'Manager', 'Approved', 'Approved', 300, 'Schedule cleared'),
       (?, ?, 'Demo Employee', 'Engineering', 'Travel', 'Demo CFO', 'CFO', 'Rejected', 'Rejected', 420, 'Budget limit exceeded for Q3 travel expenses.')`,
      [sessionId, req3Id, sessionId, req3Id, sessionId, req3Id]
    );

    await pool.query(
      `INSERT INTO notifications (demo_session_id, user_email, user_role, request_id, title, message, type) VALUES
       (?, 'employee1@zyroflow.com', 'employee', ?, 'Request Rejected', 'Request was rejected by CFO: Budget limit exceeded for Q3 travel expenses.', 'error')`,
      [sessionId, req3Id]
    );

    // 6. Request 4: Cancelled by Employee
    const [req4Res] = await pool.query(
      `INSERT INTO workflow_requests (
        demo_session_id, title, type, description, amount, department, priority, status,
        requester_name, requester_email, current_role, current_approver, approval_stage,
        workflow, payload, current_level, payment_verified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        'Marketing SaaS Evaluation Trial',
        'Marketing',
        'Initial tooling exploration trial for automation testing.',
        30000,
        'Engineering',
        'LOW',
        'Cancelled',
        'Demo Employee',
        'employee1@zyroflow.com',
        'Accounts',
        'Accounts',
        'Accounts',
        defaultChain,
        JSON.stringify({ title: 'Marketing SaaS Evaluation Trial', department: 'Engineering', priority: 'LOW' }),
        0,
        0
      ]
    );
    const req4Id = req4Res.insertId;

    await pool.query(
      `INSERT INTO approvals (demo_session_id, request_id, approver_role, step, status) VALUES
       (?, ?, 'Accounts', 0, 'Cancelled'),
       (?, ?, 'Manager', 1, 'waiting'),
       (?, ?, 'CFO', 2, 'waiting'),
       (?, ?, 'MD', 3, 'waiting')`,
      [sessionId, req4Id, sessionId, req4Id, sessionId, req4Id, sessionId, req4Id]
    );

    await pool.query(
      `INSERT INTO request_history (demo_session_id, request_id, action, performed_by) VALUES
       (?, ?, 'Created request', 'Demo Employee'),
       (?, ?, 'Cancelled by Demo Employee', 'Demo Employee')`,
      [sessionId, req4Id, sessionId, req4Id]
    );

    console.log(`[DEMO SEEDER] ✓ Workspace successfully populated for session: ${sessionId}`);
  } catch (err) {
    console.error(`[DEMO SEEDER] ❌ Error seeding demo session ${sessionId}:`, err.message);
  }
}

async function ensureDemoAdmin(pool, sessionId) {
  if (!sessionId) return;
  try {
    const [existingAdmin] = await pool.query(
      'SELECT id, employee_id, account_type FROM users WHERE demo_session_id = ? AND LOWER(role) = ? LIMIT 1',
      [sessionId, 'admin']
    );
    if (!existingAdmin || existingAdmin.length === 0) {
      const hashedAdmin = await bcrypt.hash('DemoOwner@123', 10);
      await pool.query(
        `INSERT IGNORE INTO users (demo_session_id, employee_id, name, email, password, role, phone, department, status, account_type)
         VALUES (?, 'ADM-DEMO-001', 'Demo Owner Admin', 'admin@zyroflow.com', ?, 'Admin', '+1 555-0100', 'Management', 'ACTIVE', 'DEMO_OWNER')`,
        [sessionId, hashedAdmin]
      );
    } else {
      const u = existingAdmin[0];
      if (!String(u.employee_id || '').toUpperCase().startsWith('DEMO-')) {
        await pool.query(
          'UPDATE users SET account_type = "DEMO_OWNER" WHERE id = ?',
          [u.id]
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error(`[DEMO SEEDER] Error ensuring demo admin for session ${sessionId}:`, err.message);
  }
}

module.exports = {
  seedDemoSession,
  ensureDemoAdmin
};
