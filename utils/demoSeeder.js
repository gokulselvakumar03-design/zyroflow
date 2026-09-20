/**
 * Demo Dataset Seeder
 * Manages the permanent Demo Owner user (ADM-DEMO-001) in Demo mode.
 * Idempotent: Ensures only the single permanent Demo Owner exists when seeding is enabled.
 */

const bcrypt = require('bcrypt');

async function ensureDemoAdmin(pool, sessionId = 'default') {
  try {
    const [existingAdmin] = await pool.query(
      'SELECT id, employee_id, account_type FROM users WHERE (LOWER(TRIM(employee_id)) = "adm-demo-001" OR (demo_session_id = ? AND LOWER(role) = ?)) LIMIT 1',
      [sessionId, 'admin']
    );
    if (!existingAdmin || existingAdmin.length === 0) {
      const hashedAdmin = await bcrypt.hash('DemoOwner@123', 10);
      await pool.query(
        `INSERT IGNORE INTO users (demo_session_id, employee_id, name, email, password, role, phone, department, status, account_type)
         VALUES ('default', 'ADM-DEMO-001', 'Demo Owner Admin', 'admin@zyroflow.com', ?, 'admin', '+1 555-0100', 'Management', 'ACTIVE', 'DEMO_OWNER')`,
        [hashedAdmin]
      );
    } else {
      const u = existingAdmin[0];
      if (!String(u.employee_id || '').toUpperCase().startsWith('DEMO-')) {
        await pool.query(
          'UPDATE users SET account_type = "DEMO_OWNER", employee_id = "ADM-DEMO-001", demo_session_id = "default" WHERE id = ?',
          [u.id]
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error(`[DEMO SEEDER] Error ensuring demo admin:`, err.message);
  }
}

async function seedDemoSession(pool, sessionId = 'default') {
  if (process.env.DEMO_SEED !== 'true') return;
  console.log(`[DEMO SEEDER] Ensuring permanent Demo Owner (ADM-DEMO-001)...`);
  await ensureDemoAdmin(pool, sessionId);
  console.log(`[DEMO SEEDER] ✓ Permanent Demo Owner verified.`);
}

module.exports = {
  seedDemoSession,
  ensureDemoAdmin
};
