const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mysql = require('mysql2');

// Import Auth Middleware for JWT protection
const authMiddleware = require('./middleware/authMiddleware');

// Import modular routes
const authRoutes = require('./routes/authRoutes');
const rulesRoutes = require('./routes/rulesRoutes');
const approvalsRoutes = require('./routes/approvalsRoutes');
const trackRoutes = require('./routes/trackRoutes');
const profileRoutes = require('./routes/profileRoutes');
const accountsRoutes = require('./routes/accountsRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const draftRoutes = require('./routes/draftRoutes');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use('/api/accounts', accountsRoutes);
app.use('/accounts', accountsRoutes);

let db;
let dbPool;

/**
 * Initialize MySQL Database Connection and Core Schema
 * Keeps only 5 target tables: users, workflow_requests, approvals, rules, request_history
 * Drops obsolete duplicate tables if present.
 */
async function initializeMysqlStorage() {
  try {
    console.log('Connecting to MySQL...');

    const host = process.env.MYSQL_HOST || 'localhost';
    const user = process.env.MYSQL_USER || 'root';
    const database = process.env.DB_NAME || process.env.MYSQL_DB || 'zyroflow';
    const configuredPassword = process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD;
    const passwordCandidates = configuredPassword !== undefined ? [configuredPassword] : ['root123', ''];

    let selectedPassword = passwordCandidates[0] || '';
    let lastError;
    for (const password of passwordCandidates) {
      try {
        db = mysql.createConnection({ host, user, password, multipleStatements: true });
        await new Promise((resolve, reject) => {
          db.connect((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        selectedPassword = password;
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError) {
      throw lastError;
    }

    console.log('MySQL Connected');

    await db.promise().query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
    await db.promise().query(`USE \`${database}\``);

    const [dbNameResult] = await db.promise().query('SELECT DATABASE() AS db_name');
    console.log(`[DB INIT] Connected Database Name: ${dbNameResult[0]?.db_name || database}`);

    // --- TEMPORARY MYSQL DEBUG LOGS ---
    const [infoRows] = await db.promise().query(`
      SELECT
          @@hostname AS hostname,
          @@port AS port,
          @@version AS version;
    `);
    const serverInfo = infoRows[0] || {};
    console.log('--------------------------------');
    console.log('MySQL Server Information');
    console.log(`Hostname: ${serverInfo.hostname}`);
    console.log(`Port: ${serverInfo.port}`);
    console.log(`Version: ${serverInfo.version}`);
    console.log(`Database: ${dbNameResult[0]?.db_name || database}`);
    console.log('--------------------------------');
    // ----------------------------------

    try {
      console.log('Initializing DB Schema...');
      await db.promise().execute('SET FOREIGN_KEY_CHECKS = 0');

      // Drop obsolete duplicate requests table if it exists
      await db.promise().execute('DROP TABLE IF EXISTS requests');

      await db.promise().execute('SET FOREIGN_KEY_CHECKS = 1');

      // 1. workflow_requests table
      await db.promise().execute(`
        CREATE TABLE IF NOT EXISTS workflow_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(255),
          type VARCHAR(100),
          description TEXT,
          amount INT,
          department VARCHAR(100),
          priority VARCHAR(50),
          status VARCHAR(50),
          requester_name VARCHAR(100),
          requester_email VARCHAR(100),
          current_role VARCHAR(50),
          current_approver VARCHAR(100),
          approval_stage VARCHAR(100) DEFAULT 'Accounts',
          workflow TEXT,
          payload JSON NULL,
          current_level INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      // 2. approvals table
      await db.promise().execute(`
        CREATE TABLE IF NOT EXISTS approvals (
          id INT AUTO_INCREMENT PRIMARY KEY,
          request_id INT,
          approver_role VARCHAR(50),
          step INT,
          status VARCHAR(50),
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (request_id) REFERENCES workflow_requests(id) ON DELETE CASCADE
        )
      `);

      // 3. rules table
      await db.promise().execute(`
        CREATE TABLE IF NOT EXISTS rules (
          id INT AUTO_INCREMENT PRIMARY KEY,
          request_type VARCHAR(100),
          min_amount DECIMAL(12,2) DEFAULT 0,
          max_amount DECIMAL(12,2) DEFAULT 0,
          approvers TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Default rules auto-seed disabled to allow clean scratch setup by Admin


      // 4. users table
      await db.promise().query(`
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          employee_id VARCHAR(20) UNIQUE,
          name VARCHAR(100),
          email VARCHAR(100) UNIQUE,
          password VARCHAR(100),
          role VARCHAR(50),
          phone VARCHAR(20),
          department VARCHAR(100)
        )
      `);

      // 5. payment_verifications table
      // 5. approval_history table
      await db.promise().execute(`
        CREATE TABLE IF NOT EXISTS approval_history (
          id INT AUTO_INCREMENT PRIMARY KEY,
          request_id INT NOT NULL,
          employee_name VARCHAR(100),
          department VARCHAR(100),
          request_type VARCHAR(100),
          amount DECIMAL(12,2) DEFAULT 0.00,
          priority VARCHAR(50) DEFAULT 'MEDIUM',
          manager_name VARCHAR(100) DEFAULT 'Manager',
          approval_stage VARCHAR(50) DEFAULT 'Manager',
          decision VARCHAR(50) NOT NULL,
          action VARCHAR(50) NULL,
          decision_time INT DEFAULT 0,
          decision_time_seconds INT DEFAULT 0,
          decision_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_ah_req (request_id),
          INDEX idx_ah_stage (approval_stage)
        )
      `);

      try { await db.promise().query("ALTER TABLE approval_history ADD COLUMN decision VARCHAR(50) DEFAULT 'Approved'"); } catch (e) { }
      try { await db.promise().query("ALTER TABLE approval_history ADD COLUMN decision_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP"); } catch (e) { }
      try { await db.promise().query("ALTER TABLE approval_history ADD COLUMN decision_time_seconds INT DEFAULT 0"); } catch (e) { }
      try { await db.promise().query("ALTER TABLE approval_history ADD COLUMN amount DECIMAL(12,2) DEFAULT 0.00"); } catch (e) { }
      try { await db.promise().query("ALTER TABLE approval_history ADD COLUMN priority VARCHAR(50) DEFAULT 'MEDIUM'"); } catch (e) { }
      try { await db.promise().query("ALTER TABLE approval_history ADD COLUMN comments TEXT"); } catch (e) { }
      try { await db.promise().query("ALTER TABLE approvals ADD COLUMN comments TEXT"); } catch (e) { }
      try { await db.promise().query("ALTER TABLE request_history ADD COLUMN comments TEXT"); } catch (e) { }
      try { await db.promise().query("ALTER TABLE workflow_requests ADD COLUMN rejection_reason TEXT"); } catch (e) { }

      // Clean up historic duplicate rows from approval_history
      try {
        await db.promise().query(`
          DELETE t1 FROM approval_history t1
          INNER JOIN approval_history t2 
          WHERE t1.id > t2.id 
            AND t1.request_id = t2.request_id 
            AND LOWER(t1.decision) = LOWER(t2.decision)
            AND LOWER(t1.approval_stage) = LOWER(t2.approval_stage)
            AND ABS(TIMESTAMPDIFF(SECOND, t1.timestamp, t2.timestamp)) < 30
        `);
      } catch (e) { }

      // 6. payment_verifications table
      await db.promise().execute(`
        CREATE TABLE IF NOT EXISTS payment_verifications (
          id INT AUTO_INCREMENT PRIMARY KEY,
          request_id INT NOT NULL,
          verified_by VARCHAR(100) NOT NULL,
          verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          remarks TEXT,
          status VARCHAR(50) DEFAULT 'Verified',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_pv_req (request_id),
          INDEX idx_pv_status (status),
          FOREIGN KEY (request_id) REFERENCES workflow_requests(id) ON DELETE CASCADE
        )
      `);

      // 6. notifications table
      await db.promise().execute(`
        CREATE TABLE IF NOT EXISTS notifications (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_role VARCHAR(50) DEFAULT 'accounts',
          user_email VARCHAR(100) NULL,
          request_id INT NULL,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          type VARCHAR(50) DEFAULT 'info',
          is_read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 7. draft_requests table
      await db.promise().execute(`
        CREATE TABLE IF NOT EXISTS draft_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          employee_id VARCHAR(100) NOT NULL,
          request_type VARCHAR(100),
          department VARCHAR(100),
          priority VARCHAR(50),
          payload JSON NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_draft_emp (employee_id)
        )
      `);

      try {
        await db.promise().query("ALTER TABLE notifications ADD COLUMN user_email VARCHAR(100) NULL");
      } catch (e) { }

      // Ensure essential payment_verifications, workflow_requests and user columns exist
      try {
        await db.promise().query("ALTER TABLE payment_verifications ADD COLUMN verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
      } catch (e) { }

      try {
        await db.promise().query("ALTER TABLE workflow_requests ADD COLUMN payment_verified INT DEFAULT 0");
      } catch (e) { }
      try {
        await db.promise().query("ALTER TABLE workflow_requests ADD COLUMN payment_verified_by VARCHAR(100) NULL");
      } catch (e) { }
      try {
        await db.promise().query("ALTER TABLE workflow_requests ADD COLUMN payment_verified_at TIMESTAMP NULL");
      } catch (e) { }
      try {
        await db.promise().query("ALTER TABLE workflow_requests ADD COLUMN payment_verification_status VARCHAR(50) DEFAULT 'Unverified'");
      } catch (e) { }
      try {
        await db.promise().query("ALTER TABLE workflow_requests ADD COLUMN approval_stage VARCHAR(100) DEFAULT 'Accounts'");
      } catch (e) { }

      try {
        await db.promise().query("ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id VARCHAR(20) UNIQUE");
        await db.promise().query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20)");
        await db.promise().query("ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100)");
        await db.promise().query("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image VARCHAR(255)");
        await db.promise().query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE'");
        await db.promise().query("ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email VARCHAR(255) NULL");
      } catch (e) {
        try { await db.promise().query("ALTER TABLE users ADD COLUMN employee_id VARCHAR(20) UNIQUE"); } catch (e2) { }
        try { await db.promise().query("ALTER TABLE users ADD COLUMN phone VARCHAR(20)"); } catch (e2) { }
        try { await db.promise().query("ALTER TABLE users ADD COLUMN department VARCHAR(100)"); } catch (e2) { }
        try { await db.promise().query("ALTER TABLE users ADD COLUMN profile_image VARCHAR(255)"); } catch (e2) { }
        try { await db.promise().query("ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'ACTIVE'"); } catch (e2) { }
        try { await db.promise().query("ALTER TABLE users ADD COLUMN recovery_email VARCHAR(255) NULL"); } catch (e2) { }
      }

      try {
        await db.promise().query("UPDATE users SET status = 'ACTIVE' WHERE status IS NULL OR status = ''");
      } catch (e) {
        console.error('Error migrating user status:', e.message);
      }

      try {
        await db.promise().query(`
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
      } catch (e) {
        console.error('Error creating password_reset_tokens table:', e.message);
      }

      await db.promise().query(`
        INSERT IGNORE INTO users (employee_id, name, email, password, role, phone, department, profile_image) VALUES
        ('ADM001', 'Admin', 'admin@zyroflow.com', 'admin123', 'admin', '', '', ''),
        ('ACC001', 'Accounts', 'accounts@zyroflow.com', 'acc123', 'accounts', '', '', ''),
        ('MGR001', 'Manager', 'manager@zyroflow.com', 'man123', 'manager', '', '', ''),
        ('CFO001', 'CFO', 'cfo@zyroflow.com', 'cfo123', 'cfo', '', '', ''),
        ('MD001', 'MD', 'md@zyroflow.com', 'md123', 'md', '', '', ''),
        ('EMP001', 'Employee One', 'employee1@zyroflow.com', 'emp123', 'employee', '', '', '')
      `);

      // Backfill role-based employee_id if missing
      try {
        const getRolePrefix = (role) => {
          const r = String(role || '').toLowerCase().trim();
          if (r === 'admin') return 'ADM';
          if (r === 'employee') return 'EMP';
          if (r === 'manager') return 'MGR';
          if (r === 'accounts') return 'ACC';
          if (r === 'cfo') return 'CFO';
          if (r === 'md') return 'MD';
          return 'EMP';
        };

        const [allUsers] = await db.promise().query("SELECT id, role, employee_id FROM users ORDER BY id ASC");
        for (const u of allUsers) {
          const prefix = getRolePrefix(u.role);
          const idRegex = new RegExp(`^${prefix}\\d{3}$`);
          if (!u.employee_id || !idRegex.test(u.employee_id)) {
            const [maxRow] = await db.promise().query(
              "SELECT employee_id FROM users WHERE employee_id LIKE ? ORDER BY CAST(SUBSTRING(employee_id, ?) AS UNSIGNED) DESC LIMIT 1",
              [`${prefix}%`, prefix.length + 1]
            );
            let nextNum = 1;
            if (maxRow && maxRow[0] && maxRow[0].employee_id) {
              const numPart = maxRow[0].employee_id.substring(prefix.length);
              nextNum = parseInt(numPart, 10) + 1;
            }
            const empId = `${prefix}${String(nextNum).padStart(3, '0')}`;
            await db.promise().query("UPDATE users SET employee_id = ? WHERE id = ?", [empId, u.id]);
          }
        }
      } catch (e) {
        console.error('Error backfilling role-based employee_id:', e.message);
      }

      // 5. request_history table
      await db.promise().query(`
        CREATE TABLE IF NOT EXISTS request_history (
          id INT AUTO_INCREMENT PRIMARY KEY,
          request_id BIGINT,
          action VARCHAR(100),
          performed_by VARCHAR(100),
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Ensure existing default workflow_requests contain MD in their workflow array
      try {
        const [rowsToFix] = await db.promise().query(
          "SELECT id, workflow FROM workflow_requests WHERE workflow IS NULL OR workflow = '' OR LOWER(workflow) LIKE '%[\"employee\",\"accounts\",\"manager\",\"cfo\",\"completed\"]%' OR (LOWER(workflow) LIKE '%accounts%' AND LOWER(workflow) LIKE '%manager%' AND LOWER(workflow) LIKE '%cfo%' AND LOWER(workflow) NOT LIKE '%md%')"
        );
        for (const row of rowsToFix) {
          const newWf = JSON.stringify(['Accounts', 'Manager', 'CFO', 'MD']);
          await db.promise().query("UPDATE workflow_requests SET workflow = ? WHERE id = ?", [newWf, row.id]);

          // Re-align approvals table for this request ID to Accounts -> Manager -> CFO -> MD
          await db.promise().query("DELETE FROM approvals WHERE request_id = ?", [row.id]);
          const roles = ['Accounts', 'Manager', 'CFO', 'MD'];
          for (let i = 0; i < roles.length; i += 1) {
            await db.promise().query(
              "INSERT INTO approvals (request_id, approver_role, step, status) VALUES (?, ?, ?, ?)",
              [row.id, roles[i], i, i === 0 ? 'pending' : 'waiting']
            );
          }
        }
      } catch (e) {
        console.error('Error auto-repairing default workflows to include MD:', e.message);
      }

      console.log('Database tables ready.');
    } catch (err) {
      await db.promise().execute('SET FOREIGN_KEY_CHECKS = 1');
      console.error('DB Init Error:', err);
    }

    dbPool = mysql.createPool({
      host,
      user,
      password: selectedPassword,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    }).promise();
  } catch (err) {
    console.error('MySQL initialization failed:', err.message);
    dbPool = null;
  }
}

// Serve frontend static files
app.use(express.static('frontend'));

// Mount Modular API Routes
app.use('/api/auth', authRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api', approvalsRoutes); // /api/approve, /api/reject, /api/pending-approvals
app.use('/', approvalsRoutes);    // /approve, /reject, /requests/:id/approve, /requests/:id/reject
app.use('/api', trackRoutes);     // /api/track/:requestId
app.use('/', trackRoutes);        // /track/:requestId
app.use('/api', profileRoutes);   // /api/profile, /api/change-password
app.use('/api/accounts', accountsRoutes); // /api/accounts/requests
app.use('/accounts', accountsRoutes);     // /accounts/requests
app.use('/api/notifications', notificationRoutes);
app.use('/notifications', notificationRoutes);
app.use('/api/drafts', draftRoutes);
app.use('/drafts', draftRoutes);

// ==========================================
// HELPER FUNCTIONS FOR REQUEST MAPPING
// ==========================================

function parseJsonValue(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function getWorkflowList(row) {
  const workflow = parseJsonValue(row.workflow, []);
  let list = Array.isArray(workflow) ? workflow : [];
  const cleanList = list.filter(item => {
    const s = String(item || '').trim().toLowerCase();
    return s !== 'employee' && s !== 'completed' && s !== 'user';
  });

  if (!cleanList.length) {
    return ['Accounts', 'Manager', 'CFO', 'MD'];
  }

  const lowerList = cleanList.map(s => String(s).toLowerCase());
  if (lowerList.includes('accounts') && lowerList.includes('manager') && lowerList.includes('cfo') && !lowerList.includes('md')) {
    cleanList.push('MD');
  }

  return cleanList;
}

function mapRequestRow(row) {
  console.log('[DEBUG mapRequestRow] DB row:', row);
  const workflow = getWorkflowList(row);
  const payload = parseJsonValue(row.payload, {});
  const createdAt = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : createdAt;
  const currentLevel = Number(row.current_level ?? 0);
  const currentRole = row.current_role || workflow[Math.min(currentLevel, Math.max(workflow.length - 1, 0))] || '';
  const currentApprover = row.current_approver || currentRole || '';
  const approvalStage = row.approval_stage || currentRole || '';

  const isVerified = Number(row.payment_verified ?? 0) === 1 || String(row.payment_verification_status || '').toLowerCase() === 'verified';

  const mapped = {
    id: Number(row.id),
    title: row.title || row.type || payload.title || '',
    request_type: row.type || row.request_type || row.title || payload.request_type || '',
    type: row.type || row.request_type || row.title || payload.request_type || '',
    department: row.department || payload.department || '',
    priority: row.priority || payload.priority || '',
    description: row.description || payload.description || '',
    amount: Number(row.amount || payload.amount || 0),
    status: row.status || payload.status || 'pending',
    approval_stage: approvalStage,
    approvalStage: approvalStage,
    requester: row.requester_name || payload.requester || payload.requester_name || '',
    requester_name: row.requester_name || payload.requester || payload.requester_name || '',
    requesterEmail: row.requester_email || payload.requesterEmail || payload.email || '',
    requester_email: row.requester_email || payload.requesterEmail || payload.email || '',
    currentRole: currentRole,
    current_role: currentRole,
    currentApprover: currentApprover,
    current_approver: currentApprover,
    currentLevel,
    current_level: currentLevel,
    workflow,
    is_edited: (payload && (payload.is_edited === 1 || payload.is_edited === true || payload.isEdited === 1 || payload.isEdited === true)) ? 1 : 0,
    isEdited: (payload && (payload.is_edited === 1 || payload.is_edited === true || payload.isEdited === 1 || payload.isEdited === true)) ? 1 : 0,
    payment_verified: isVerified ? 1 : 0,
    payment_verified_by: row.payment_verified_by || null,
    payment_verified_at: row.payment_verified_at || null,
    payment_verification_status: isVerified ? "Verified" : "Pending",
    rejection_reason: row.rejection_reason || payload.rejection_reason || payload.rejectionReason || payload.reason || payload.comments || null,
    rejectionReason: row.rejection_reason || payload.rejection_reason || payload.rejectionReason || payload.reason || payload.comments || null,
    comments: row.comments || payload.comments || null,
    receipt_url: payload.attached_file_url || payload.receipt_file || payload.receipt_url || payload.attachment || payload.image || payload.photo || payload.file || null,
    attachment_url: payload.attached_file_url || payload.receipt_file || payload.receipt_url || payload.attachment || payload.image || payload.photo || payload.file || null,
    image_url: payload.attached_file_url || payload.receipt_file || payload.receipt_url || payload.attachment || payload.image || payload.photo || payload.file || null,
    fileName: payload.attached_file_name || payload.fileName || payload.file_name || payload.receipt_name || null,
    file_name: payload.attached_file_name || payload.fileName || payload.file_name || payload.receipt_name || null,
    attachments: (Array.isArray(payload.attachments) && payload.attachments.length) ? payload.attachments :
      ((payload.attached_file_url || payload.receipt_url) ? [
        {
          name: payload.attached_file_name || payload.fileName || payload.file_name || 'Attached Photo / Document',
          type: payload.attached_file_type || '',
          url: payload.attached_file_url || payload.receipt_file || payload.receipt_url || payload.attachment || payload.image || payload.photo || payload.file
        }
      ] : []),
    payload,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
  };

  console.log('[DEBUG mapRequestRow] Mapped result:', mapped);
  return mapped;
}

/**
 * Determine approval chain by checking rules table or using provided workflow.
 * Automatically filters out non-approver roles (e.g., 'Employee', 'Completed')
 * so that current_role and step 0 always start at the first actual financial approver.
 */
async function getApprovalChain(type, amount, customWorkflow) {
  const sanitizeApprovers = (chain) => {
    if (!Array.isArray(chain)) return [];
    const seen = new Set();
    const result = [];
    for (const rawRole of chain) {
      const role = String(rawRole).trim();
      const lower = role.toLowerCase();
      if (role && !['employee', 'requester', 'completed'].includes(lower)) {
        let cleanRole = role;
        if (lower === 'accounts') cleanRole = 'Accounts';
        else if (lower === 'manager') cleanRole = 'Manager';
        else if (lower === 'cfo') cleanRole = 'CFO';
        else if (lower === 'md') cleanRole = 'MD';

        const cleanLower = cleanRole.toLowerCase();
        if (!seen.has(cleanLower)) {
          seen.add(cleanLower);
          result.push(cleanRole);
        }
      }
    }
    return result;
  };

  let chain = [];

  // 1. Query the rules table for an exact matching rule based on request_type and amount range
  if (dbPool) {
    try {
      const cleanType = String(type || '').trim().toLowerCase();
      const isLeave = cleanType === 'leave request' || cleanType === 'leave';
      const numAmt = Number(amount || 0);

      let rules = [];
      if (isLeave || numAmt === 0) {
        const [res] = await dbPool.execute(
          'SELECT * FROM rules WHERE LOWER(TRIM(request_type)) = LOWER(TRIM(?)) ORDER BY id DESC LIMIT 1',
          [type]
        );
        rules = res;
      }
      if (!rules || rules.length === 0) {
        const [res] = await dbPool.execute(
          'SELECT * FROM rules WHERE LOWER(TRIM(request_type)) = LOWER(TRIM(?)) AND ? >= min_amount AND (max_amount IS NULL OR max_amount = 0 OR ? <= max_amount) ORDER BY min_amount DESC LIMIT 1',
          [type, numAmt, numAmt]
        );
        rules = res;
      }

      if (rules && rules.length > 0 && rules[0].approvers) {
        const ruleChain = String(rules[0].approvers).split(',').map(s => s.trim()).filter(Boolean);
        chain = sanitizeApprovers(ruleChain);
      }
    } catch (err) {
      console.error('[getApprovalChain] Error querying rules table:', err.message);
    }
  }

  // 2. If customWorkflow provided by client and rules yielded nothing
  if (chain.length === 0 && customWorkflow) {
    const parsed = parseJsonValue(customWorkflow, []);
    chain = sanitizeApprovers(parsed);
  }

  // If chain lacks MD and is a 3-step default chain (Accounts, Manager, CFO), append MD
  if (chain.length === 3 && chain[0] === 'Accounts' && chain[1] === 'Manager' && chain[2] === 'CFO') {
    chain = ['Accounts', 'Manager', 'CFO', 'MD'];
  }

  // 3. Fallback default approver chain
  if (chain.length === 0) {
    chain = ['Accounts', 'Manager', 'CFO', 'MD'];
  }

  return sanitizeApprovers(chain);
}

function normalizeRequestInput(body = {}, user = {}) {
  const workflow = parseJsonValue(body.workflow, []);
  const workflowArray = Array.isArray(workflow) ? workflow : [];
  const currentLevel = Number(body.current_level ?? body.currentLevel ?? 0);
  const currentRole = body.current_role || body.currentRole || workflowArray[Math.min(currentLevel, Math.max(workflowArray.length - 1, 0))] || '';
  const payload = parseJsonValue(body.payload, null) || body;

  const reqName = user.name || body.requester_name || body.requesterName || payload.requester_name || payload.requester || user.email || 'Employee';
  const reqEmail = user.email || body.requester_email || body.requesterEmail || payload.requester_email || payload.email || '';

  return {
    title: body.title || body.request_type || body.type || payload.title || payload.request_type || payload.type || 'General Request',
    type: body.type || body.request_type || body.title || payload.type || payload.request_type || payload.title || 'general',
    description: body.description || payload.description || '',
    amount: Number(body.amount ?? payload.amount ?? 0),
    department: body.department || payload.department || '',
    priority: body.priority || payload.priority || 'medium',
    status: String(body.status || payload.status || 'pending').toLowerCase(),
    requester_name: reqName,
    requester_email: reqEmail,
    current_role: currentRole || 'Manager',
    current_approver: body.current_approver || body.currentApprover || currentRole || 'Manager',
    workflow: JSON.stringify(workflowArray),
    payload: JSON.stringify(payload),
    current_level: currentLevel,
  };
}

// Optional Auth Middleware helper to allow requests with token while supporting legacy public routes
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authMiddleware(req, res, next);
  }
  next();
}

// ==========================================
// UNIFIED /requests ENDPOINTS (workflow_requests)
// ==========================================

/**
 * GET /requests
 * Role-Based Filtering:
 * - Employee: Views only their own requests.
 * - Approver (Accounts, Manager, CFO, MD): Views requests assigned to their role/level.
 * - Admin: Views all requests.
 */
app.get(['/requests', '/api/requests'], optionalAuth, async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ message: 'Database unavailable' });
  }

  try {
    const user = req.user;
    const queryRole = req.query.role || null;
    let query = 'SELECT * FROM workflow_requests ORDER BY id DESC';
    let params = [];

    if (queryRole) {
      const role = String(queryRole).toLowerCase().trim();

      if (role === 'employee') {
        query = `
          SELECT * FROM workflow_requests
          WHERE LOWER(requester_email) = LOWER(?) OR LOWER(requester_name) = LOWER(?)
          ORDER BY id DESC
        `;
        params = [user?.email || '', user?.name || ''];
      } else if (['manager', 'accounts', 'cfo', 'md'].includes(role)) {
        const statusMatch = `pending ${role} approval`;
        const extraMdCondition = role === 'md' ? "OR LOWER(status) LIKE '%cfo%' OR LOWER(status) LIKE '%escalat%'" : "";
        query = `
          SELECT * FROM workflow_requests
          WHERE LOWER(status) = LOWER(?)
             OR (
               (LOWER(status) = 'pending' OR LOWER(status) LIKE 'pending%' ${extraMdCondition})
               AND (
                 LOWER(current_approver) = LOWER(?)
                 OR LOWER(current_role) = LOWER(?)
                 OR LOWER(approval_stage) = LOWER(?)
               )
             )
             ${role === 'md' ? "OR LOWER(status) LIKE '%escalat%' OR LOWER(status) LIKE '%cfo forwarded%' OR LOWER(status) LIKE '%cfo approved%'" : ""}
          ORDER BY id DESC
        `;
        params = [statusMatch, role, role, role];
      }
    }

    const [allReqs] = await dbPool.query('SELECT id, requester_email, requester_name FROM workflow_requests ORDER BY id ASC');
    const [allUsers] = await dbPool.query('SELECT id, employee_id, name, email FROM users');

    const userMap = new Map();
    (allUsers || []).forEach(u => {
      if (u.email) userMap.set(u.email.toLowerCase().trim(), u);
    });

    const userSeqMap = new Map();
    const reqsByUser = new Map();
    (allReqs || []).forEach(r => {
      const key = String(r.requester_email || r.requester_name || 'employee').toLowerCase().trim();
      if (!reqsByUser.has(key)) reqsByUser.set(key, []);
      reqsByUser.get(key).push(r);
    });
    reqsByUser.forEach((list) => {
      list.forEach((r, idx) => {
        userSeqMap.set(Number(r.id), idx + 1);
      });
    });

    const [rows] = await dbPool.query(query, params);

    // Fetch request_history for requests so dashboard has real cancellation & submission events
    const historyByReqId = new Map();
    try {
      const [allHist] = await dbPool.query(
        'SELECT id, request_id, action, performed_by, timestamp, comments FROM request_history ORDER BY id ASC'
      );
      (allHist || []).forEach(h => {
        const reqId = Number(h.request_id);
        if (!historyByReqId.has(reqId)) historyByReqId.set(reqId, []);
        historyByReqId.get(reqId).push(h);
      });
    } catch (e) {}

    const data = rows.map(r => {
      const mapped = mapRequestRow(r);
      const seq = userSeqMap.get(Number(r.id)) || Number(r.id);
      const user = userMap.get(String(r.requester_email || '').toLowerCase().trim());
      const empId = user?.employee_id || (String(r.requester_email).includes('employee1') ? 'EMP-01' : (String(r.requester_email).includes('employee3') ? 'EMP-04' : (String(r.requester_email).includes('employee2') ? 'EMP-03' : 'EMP-01')));
      const empName = user?.name || r.requester_name || 'Employee';
      const reqHist = historyByReqId.get(Number(r.id)) || [];
      return {
        ...mapped,
        history: reqHist,
        db_id: mapped.id,
        dbId: mapped.id,
        seq_num: seq,
        seqNum: seq,
        user_seq: seq,
        employee_id: empId,
        employeeId: empId,
        empId: empId,
        employee_name: empName,
        employeeName: empName,
        empName: empName
      };
    });
    res.json(data);
  } catch (error) {
    console.error('GET /requests failed:', error.message);
    res.status(500).json({ message: 'Failed to fetch requests' });
  }
});

/**
 * GET /requests/:id or /api/requests/:id
 * Fetches a single request by ID.
 */
app.get(['/requests/:id', '/api/requests/:id'], optionalAuth, async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ message: 'Database unavailable' });
  }

  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ message: 'Invalid request id' });
    }

    const [rows] = await dbPool.execute(
      `SELECT id, title, type, description, amount, department, priority, status,
              requester_name, requester_email, current_role, current_approver, approval_stage, workflow,
              payload, current_level, created_at, updated_at,
              payment_verified, payment_verified_by, payment_verified_at, payment_verification_status
       FROM workflow_requests WHERE id = ? LIMIT 1`,
      [requestId]
    );
    if (!rows.length) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const requestData = mapRequestRow(rows[0]);

    // Check ownership if user is logged in as employee
    if (req.user && String(req.user.role).toLowerCase() === 'employee') {
      const userEmail = String(req.user.email || '').toLowerCase();
      const reqEmail = String(requestData.requester_email || '').toLowerCase();
      if (reqEmail && userEmail && reqEmail !== userEmail) {
        return res.status(403).json({ message: 'Access denied to this request' });
      }
    }

    // Fetch approval timeline steps
    try {
      const [approvalRows] = await dbPool.execute(
        `SELECT id, step, approver_role, status, updated_at, comments FROM approvals WHERE request_id = ? ORDER BY step ASC`,
        [requestId]
      );
      requestData.timeline = approvalRows;
      requestData.approvals = approvalRows;
    } catch (e) {
      requestData.timeline = [];
      requestData.approvals = [];
    }

    // Fetch decision history / audit log
    try {
      const [historyRows] = await dbPool.execute(
        `SELECT id, action, performed_by, timestamp FROM request_history WHERE request_id = ? ORDER BY id ASC`,
        [requestId]
      );
      const [appHistRows] = await dbPool.execute(
        `SELECT id, manager_name, approval_stage, decision, action, decision_timestamp, timestamp, comments FROM approval_history WHERE request_id = ? ORDER BY id ASC`,
        [requestId]
      );
      requestData.history = historyRows;
      requestData.approval_history = appHistRows;
    } catch (e) {
      requestData.history = [];
      requestData.approval_history = [];
    }

    // Attachments handling from payload JSON if present
    try {
      const payloadObj = typeof requestData.payload === 'string' ? JSON.parse(requestData.payload) : (requestData.payload || {});
      requestData.attachments = payloadObj.attachments || payloadObj.files || (payloadObj.attachment ? [payloadObj.attachment] : []);
    } catch (e) {
      requestData.attachments = [];
    }

    console.log('[DEBUG GET /requests/:id] Sending enriched responseJson with timeline & history');
    res.json(requestData);
  } catch (error) {
    console.error('GET /requests/:id failed:', error.message);
    res.status(500).json({ message: 'Failed to fetch request' });
  }
});

/**
 * POST /requests or /api/requests
 * Creates a new request in workflow_requests, generates approval steps, and logs history.
 * Uses logged-in user details from JWT token (req.user).
 */
app.post(['/requests', '/api/requests'], optionalAuth, async (req, res) => {
  console.log("========== POST /requests ==========");
  console.log("Logged-in user:", req.user);
  console.log("Request Body:", req.body);

  if (!dbPool) {
    return res.status(500).json({ success: false, error: 'Database unavailable' });
  }

  try {
    const user = req.user || {};
    const input = req.body || {};

    const type = input.request_type || input.type || input.title || 'general';
    const amount = Number(input.amount ?? 0);

    // Determine approval chain from rules table (or sanitized custom workflow)
    const approverChain = await getApprovalChain(type, amount, input.workflow);

    // FIX: Set current_role, current_approver, approval_stage to the actual first financial approver (e.g., 'Accounts')
    const firstApprover = approverChain[0] || 'Accounts';
    const initialStatus = `Pending ${firstApprover} Approval`;

    // Prepare normalized request data with JWT user details and initial approval state
    const requestData = normalizeRequestInput({
      ...input,
      workflow: JSON.stringify(approverChain),
      current_role: firstApprover,
      current_approver: firstApprover,
      approval_stage: firstApprover,
      current_level: 0,
      status: initialStatus
    }, user);

    const [result] = await dbPool.execute(
      `INSERT INTO workflow_requests
       (title, type, description, amount, department, priority, status, approval_stage, requester_name, requester_email, current_role, current_approver, workflow, payload, current_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        requestData.title,
        requestData.type,
        requestData.description,
        requestData.amount,
        requestData.department,
        requestData.priority,
        initialStatus,
        firstApprover,
        requestData.requester_name,
        requestData.requester_email,
        firstApprover,
        firstApprover,
        requestData.workflow,
        requestData.payload,
        0,
      ]
    );

    const requestId = result.insertId;
    console.log("Inserted Request ID:", requestId);
    console.log("Approval Chain:", approverChain);

    // Auto-delete associated draft upon successful request submission
    const draftId = req.body.draft_id || req.body.draftId || (req.body.payload && (req.body.payload.draft_id || req.body.payload.draftId));
    if (draftId) {
      await dbPool.execute('DELETE FROM draft_requests WHERE id = ?', [draftId]).catch(() => { });
    }
    if (requestData.requester_email) {
      await dbPool.execute(
        'DELETE FROM draft_requests WHERE LOWER(employee_id) = LOWER(?) AND LOWER(request_type) = LOWER(?)',
        [requestData.requester_email, requestData.type || '']
      ).catch(() => { });
    }

    // Delete any existing approvals for this request ID before inserting fresh rows
    await dbPool.execute('DELETE FROM approvals WHERE request_id = ?', [requestId]);

    // Insert corresponding steps into approvals table
    for (let i = 0; i < approverChain.length; i += 1) {
      await dbPool.execute(
        `INSERT INTO approvals (request_id, approver_role, step, status)
         VALUES (?, ?, ?, ?)`,
        [
          requestId,
          approverChain[i],
          i,
          i === 0 ? 'pending' : 'waiting'
        ]
      );
    }

    // Insert initial history record into request_history table
    await dbPool.execute(
      `INSERT INTO request_history (request_id, action, performed_by)
       VALUES (?, ?, ?)`,
      [requestId, 'Created request', requestData.requester_name]
    );

    // 1. Employee Notification: Request submitted successfully.
    if (requestData.requester_email) {
      await dbPool.execute(
        `INSERT INTO notifications (user_email, user_role, request_id, title, message, type)
         VALUES (?, 'employee', ?, 'Request Submitted', 'Request submitted successfully.', 'success')`,
        [requestData.requester_email, requestId]
      ).catch(() => { });
    }

    // 2. Accounts Notification: New request submitted.
    await dbPool.execute(
      `INSERT INTO notifications (user_role, request_id, title, message, type)
       VALUES ('accounts', ?, 'New Request', 'New request submitted.', 'info')`,
      [requestId]
    ).catch(() => { });

    const [createdRows] = await dbPool.execute('SELECT * FROM workflow_requests WHERE id = ? LIMIT 1', [requestId]);
    const createdRequest = mapRequestRow(createdRows[0]);

    res.status(201).json({
      success: true,
      id: requestId,
      request_id: requestId,
      request: createdRequest
    });
  } catch (err) {
    console.error('POST /requests failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /requests/:id
 * Allows employees to edit only PENDING requests.
 */
app.put('/requests/:id', optionalAuth, async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ success: false, error: 'Database unavailable' });
  }

  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid request id' });
    }

    const [rows] = await dbPool.execute('SELECT * FROM workflow_requests WHERE id = ? LIMIT 1', [requestId]);
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    const existing = mapRequestRow(rows[0]);
    if (!String(existing.status || '').toLowerCase().includes('pending')) {
      return res.status(409).json({ success: false, error: 'Only pending requests can be edited' });
    }

    // Check ownership if user is logged in as employee
    if (req.user && String(req.user.role).toLowerCase() === 'employee') {
      const userEmail = String(req.user.email || '').toLowerCase();
      const reqEmail = String(existing.requester_email || '').toLowerCase();
      if (reqEmail && userEmail && reqEmail !== userEmail) {
        return res.status(403).json({ success: false, error: 'You can only edit your own requests' });
      }
    }

    const existingPayload = parseJsonValue(rows[0].payload, {}) || {};

    let incomingPayload = parseJsonValue(req.body.payload, {}) || {};
    const url = incomingPayload.attached_file_url;
    if (!url || url === 'PRESERVE_EXISTING' || incomingPayload.preserve_existing_attachment) {
      incomingPayload.attached_file_url = existingPayload.attached_file_url || existing.receipt_url || existing.attachment_url;
      incomingPayload.attached_file_name = incomingPayload.attached_file_name || existingPayload.attached_file_name || existing.fileName;
      incomingPayload.attached_file_type = incomingPayload.attached_file_type || existingPayload.attached_file_type || 'image/jpeg';
      incomingPayload.attachments = (Array.isArray(existingPayload.attachments) && existingPayload.attachments.length) ? existingPayload.attachments : existing.attachments;
      incomingPayload.receipt_file = incomingPayload.attached_file_url;
      incomingPayload.receipt_url = incomingPayload.attached_file_url;
    }
    incomingPayload.is_edited = 1;
    req.body.payload = JSON.stringify(incomingPayload);

    const updateData = normalizeRequestInput(req.body || {}, req.user || {});

    // Re-evaluate approval chain for updated request_type and amount
    const approverChain = await getApprovalChain(updateData.type, updateData.amount, req.body.workflow);
    const firstApprover = approverChain[0] || 'Accounts';
    const newStatus = `Pending ${firstApprover} Approval`;

    await dbPool.execute(
      `UPDATE workflow_requests
       SET title = ?, type = ?, description = ?, amount = ?, department = ?, priority = ?, status = ?, approval_stage = ?, requester_name = ?, requester_email = ?, current_role = ?, current_approver = ?, workflow = ?, payload = ?, current_level = 0
       WHERE id = ?`,
      [
        updateData.title,
        updateData.type,
        updateData.description,
        updateData.amount,
        updateData.department,
        updateData.priority,
        newStatus,
        firstApprover,
        updateData.requester_name || existing.requester,
        updateData.requester_email || existing.requesterEmail,
        firstApprover,
        firstApprover,
        JSON.stringify(approverChain),
        updateData.payload,
        requestId,
      ]
    );

    // Refresh steps in approvals table for updated request
    await dbPool.execute('DELETE FROM approvals WHERE request_id = ?', [requestId]);
    for (let i = 0; i < approverChain.length; i += 1) {
      await dbPool.execute(
        `INSERT INTO approvals (request_id, approver_role, step, status)
         VALUES (?, ?, ?, 'pending')`,
        [requestId, approverChain[i], i]
      );
    }

    // Log update in request_history
    const performer = req.user?.name || req.user?.email || existing.requester || 'User';
    await dbPool.execute(
      `INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)`,
      [requestId, `Updated request amount to ₹${updateData.amount.toLocaleString('en-IN')}`, performer]
    );

    const [updatedRows] = await dbPool.execute('SELECT * FROM workflow_requests WHERE id = ? LIMIT 1', [requestId]);
    res.json({ success: true, request: mapRequestRow(updatedRows[0]) });
  } catch (err) {
    console.error('PUT /requests/:id failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /requests/:id/update-photo or /api/requests/:id/update-photo
 * Allows employees to update attached photo on pending initial verification requests.
 */
app.post(['/requests/:id/update-photo', '/api/requests/:id/update-photo'], optionalAuth, async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ success: false, error: 'Database unavailable' });
  }

  try {
    const requestId = Number(req.params.id);
    const { photo_url, photoUrl, file_name, fileName } = req.body || {};
    const url = photo_url || photoUrl;
    const name = file_name || fileName || 'Attached Photo';

    if (!requestId || !url) {
      return res.status(400).json({ success: false, message: 'Valid request_id and photo_url are required' });
    }

    const [rows] = await dbPool.execute('SELECT * FROM workflow_requests WHERE id = ? LIMIT 1', [requestId]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    const reqRow = rows[0];
    const statusLower = String(reqRow.status || '').toLowerCase();
    const currentLevel = Number(reqRow.current_level || 0);

    if (!statusLower.includes('pending') || currentLevel > 0 || Number(reqRow.payment_verified || 0) === 1) {
      return res.status(409).json({ success: false, message: 'Photos can only be updated while the request is pending initial verification.' });
    }

    let payloadObj = parseJsonValue(reqRow.payload, {});
    payloadObj.attached_file_url = url;
    payloadObj.attached_file_name = name;
    payloadObj.receipt_photo = url;

    await dbPool.execute(
      'UPDATE workflow_requests SET payload = ? WHERE id = ?',
      [JSON.stringify(payloadObj), requestId]
    );

    const performer = req.user ? (req.user.name || req.user.email) : (reqRow.requester_name || 'Employee');
    await dbPool.execute(
      'INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)',
      [requestId, 'Updated attached photo', performer]
    );

    const [updatedRows] = await dbPool.execute('SELECT * FROM workflow_requests WHERE id = ? LIMIT 1', [requestId]);
    res.json({ success: true, message: 'Photo updated successfully', request: mapRequestRow(updatedRows[0]) });
  } catch (err) {
    console.error('POST /requests/:id/update-photo failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /requests/:id/status
 * Allows employees to cancel PENDING requests or update status.
 */
app.patch('/requests/:id/status', optionalAuth, async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ success: false, error: 'Database unavailable' });
  }

  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid request id' });
    }

    const newStatus = String(req.body?.status || '').trim().toLowerCase();
    if (!newStatus) {
      return res.status(400).json({ success: false, error: 'status is required' });
    }

    const [rows] = await dbPool.execute('SELECT * FROM workflow_requests WHERE id = ? LIMIT 1', [requestId]);
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    const existing = mapRequestRow(rows[0]);
    if (newStatus === 'cancelled' && !String(existing.status || '').toLowerCase().includes('pending')) {
      return res.status(409).json({ success: false, error: 'This request can no longer be cancelled.' });
    }

    const statusToSave = newStatus === 'cancelled' ? 'Cancelled' : req.body.status;
    await dbPool.execute(
      'UPDATE workflow_requests SET status = ? WHERE id = ?',
      [statusToSave, requestId]
    );

    // Also update approvals table to Cancelled if cancelled
    if (newStatus === 'cancelled') {
      await dbPool.execute(
        "UPDATE approvals SET status = 'Cancelled' WHERE request_id = ? AND LOWER(status) = 'pending'",
        [requestId]
      ).catch(() => {});
    }

    // Log status update in request_history
    const performer = req.user?.name || req.user?.email || existing.requester_name || existing.requester || 'Requester';
    const actionText = newStatus === 'cancelled' ? `Cancelled by ${performer}` : `Status updated to ${newStatus}`;
    await dbPool.execute(
      `INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)`,
      [requestId, actionText, performer]
    );

    const [updatedRows] = await dbPool.execute('SELECT * FROM workflow_requests WHERE id = ? LIMIT 1', [requestId]);
    res.json({ success: true, request: mapRequestRow(updatedRows[0]) });
  } catch (err) {
    console.error('PATCH /requests/:id/status failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /requests/:id
 * Deletes a request and cleans up associated approvals and history records.
 */
app.delete('/requests/:id', optionalAuth, async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ success: false, error: 'Database unavailable' });
  }

  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid request id' });
    }

    const [rows] = await dbPool.execute('SELECT * FROM workflow_requests WHERE id = ? LIMIT 1', [requestId]);
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    await dbPool.execute('DELETE FROM approvals WHERE request_id = ?', [requestId]);
    await dbPool.execute('DELETE FROM request_history WHERE request_id = ?', [requestId]);
    await dbPool.execute('DELETE FROM workflow_requests WHERE id = ?', [requestId]);

    res.json({ success: true, message: 'Request deleted successfully', id: requestId });
  } catch (err) {
    console.error('DELETE /requests/:id failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// APPROVAL & WORKFLOW ENDPOINTS
// ==========================================

app.get('/approvals/:requestId', optionalAuth, async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ error: 'Database unavailable' });
  }

  try {
    const { requestId } = req.params;
    const [rows] = await dbPool.execute(
      `SELECT approver_role, step, status
       FROM approvals
       WHERE request_id = ?
       ORDER BY step ASC`,
      [requestId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(['/api/manager/analytics', '/manager/analytics', '/api/analytics/dashboard'], async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ error: 'Database unavailable' });
  }


  try {
    const targetRole = req.query.role || 'Manager';
    const isFilteredByRole = targetRole && String(targetRole).toLowerCase() !== 'all';
    const roleParam = isFilteredByRole ? String(targetRole).toLowerCase().trim() : null;

    // 1. Counts directly from workflow_requests using exact status matching
    const [mgrPendingRes] = await dbPool.query("SELECT COUNT(*) as count FROM workflow_requests WHERE LOWER(status) = 'pending manager approval'");
    const [overallPendingRes] = await dbPool.query("SELECT COUNT(*) as count FROM workflow_requests WHERE LOWER(status) LIKE 'pending%' OR LOWER(status) = 'waiting'");
    const [wfApprovedRes] = await dbPool.query("SELECT COUNT(*) as count FROM workflow_requests WHERE LOWER(status) = 'approved'");
    const [wfRejectedRes] = await dbPool.query("SELECT COUNT(*) as count FROM workflow_requests WHERE LOWER(status) = 'rejected'");
    const [totalRequestsRes] = await dbPool.query("SELECT COUNT(*) as count FROM workflow_requests WHERE LOWER(status) != 'cancelled'");
    const [escalatedRes] = await dbPool.query("SELECT COUNT(*) as count FROM workflow_requests WHERE LOWER(status) LIKE '%escalat%'");

    const managerPending = mgrPendingRes[0]?.count || 0;
    const overallPending = overallPendingRes[0]?.count || 0;
    const approvedCount = wfApprovedRes[0]?.count || 0;
    const rejectedCount = wfRejectedRes[0]?.count || 0;
    const totalRequests = totalRequestsRes[0]?.count || 0;
    const escalatedCount = escalatedRes[0]?.count || 0;

    // 2. Fetch Latest Deduplicated Approval History (One record per request_id, latest decision) JOINED with workflow_requests
    const latestQuery = `
      SELECT ah.*,
             wr.amount as req_amount,
             wr.created_at as req_created_at,
             COALESCE(NULLIF(ah.department, ''), wr.department, 'Finance') as final_department
      FROM approval_history ah
      INNER JOIN (
        SELECT request_id, MAX(id) as max_id
        FROM approval_history
        ${isFilteredByRole ? 'WHERE LOWER(approval_stage) = LOWER(?) OR LOWER(manager_name) = LOWER(?)' : ''}
        GROUP BY request_id
      ) latest ON ah.id = latest.max_id
      LEFT JOIN workflow_requests wr ON ah.request_id = wr.id
    `;
    const latestParams = isFilteredByRole ? [roleParam, roleParam] : [];
    const [latestDecisions] = await dbPool.query(latestQuery, latestParams);

    // 3. Raw Approval History list for table & matching /approval-history endpoint
    let historyQuery = 'SELECT * FROM approval_history ORDER BY id DESC LIMIT 100';
    let historyParams = [];
    if (isFilteredByRole) {
      historyQuery = 'SELECT * FROM approval_history WHERE LOWER(approval_stage) = LOWER(?) OR LOWER(manager_name) = LOWER(?) ORDER BY id DESC LIMIT 100';
      historyParams = [roleParam, roleParam];
    }
    const [historyRows] = await dbPool.query(historyQuery, historyParams);

    // 4. Decision metrics from approval history
    let decApproved = 0;
    let decRejected = 0;
    latestDecisions.forEach((row) => {
      const dec = String(row.decision || row.action || '').toLowerCase();
      if (dec.includes('approve')) {
        decApproved++;
      } else if (dec.includes('reject')) {
        decRejected++;
      }
    });

    const totalDecisions = decApproved + decRejected;
    const approvalRate = totalDecisions > 0 ? Math.round((decApproved / totalDecisions) * 100) : 0;

    // 5. Budget Analysis (ONLY APPROVED requests from latest decisions JOINED with workflow_requests)
    const approvedRequests = latestDecisions.filter((row) =>
      String(row.decision || row.action || '').toLowerCase().includes('approve')
    );

    const approvedAmounts = approvedRequests.map((r) => Number(r.req_amount || r.amount || 0));

    const highestApprovedAmount = approvedAmounts.length > 0 ? Math.max(...approvedAmounts) : 0;
    const lowestApprovedAmount = approvedAmounts.length > 0 ? Math.min(...approvedAmounts) : 0;
    const totalApprovedBudget = approvedAmounts.reduce((sum, val) => sum + val, 0);
    const avgApprovedAmount = approvedAmounts.length > 0 ? Math.round(totalApprovedBudget / approvedAmounts.length) : 0;

    // 6. Average Decision Time (Request created_at -> Latest decision_timestamp)
    let totalTimeSec = 0;
    let timedDecisionsCount = 0;

    latestDecisions.forEach((row) => {
      const startTime = row.req_created_at ? new Date(row.req_created_at).getTime() : null;
      const endTime = row.decision_timestamp || row.timestamp ? new Date(row.decision_timestamp || row.timestamp).getTime() : null;

      if (startTime && endTime && endTime >= startTime) {
        totalTimeSec += (endTime - startTime) / 1000;
        timedDecisionsCount++;
      } else if (Number(row.decision_time_seconds || row.decision_time || 0) > 0) {
        totalTimeSec += Number(row.decision_time_seconds || row.decision_time);
        timedDecisionsCount++;
      }
    });

    const avgDecisionTimeMins = timedDecisionsCount > 0 ? Math.round((totalTimeSec / timedDecisionsCount) / 60) : 0;

    // 7. Top Department (Department with highest completed requests from latest decisions)
    const deptCounts = {};
    latestDecisions.forEach((row) => {
      const dept = row.final_department || 'Finance';
      deptCounts[dept] = (deptCounts[dept] || 0) + 1;
    });

    let topDepartment = 'N/A';
    let maxDeptCount = 0;
    Object.keys(deptCounts).forEach((dept) => {
      if (deptCounts[dept] > maxDeptCount) {
        maxDeptCount = deptCounts[dept];
        topDepartment = dept;
      }
    });

    // 8. Most Active Day (Day with highest completed approvals/rejections from latest decisions)
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayCounts = {};

    latestDecisions.forEach((row) => {
      const dt = row.decision_timestamp || row.timestamp ? new Date(row.decision_timestamp || row.timestamp) : null;
      if (dt && !isNaN(dt.getTime())) {
        const dName = dayNames[dt.getDay()];
        dayCounts[dName] = (dayCounts[dName] || 0) + 1;
      }
    });

    let mostActiveDay = 'N/A';
    let maxDayCount = 0;
    Object.keys(dayCounts).forEach((day) => {
      if (dayCounts[day] > maxDayCount) {
        maxDayCount = dayCounts[day];
        mostActiveDay = day;
      }
    });

    // 9. Chart Datasets
    // Chart 1: Approval Trend (Grouped by Date from approval_history)
    const [trendRows] = await dbPool.query(`
      SELECT DATE_FORMAT(timestamp, '%Y-%m-%d') as date,
             SUM(CASE WHEN LOWER(decision) LIKE 'approve%' THEN 1 ELSE 0 END) as approved,
             SUM(CASE WHEN LOWER(decision) LIKE 'reject%' THEN 1 ELSE 0 END) as rejected
      FROM approval_history
      ${isFilteredByRole ? 'WHERE LOWER(approval_stage) = LOWER(?) OR LOWER(manager_name) = LOWER(?)' : ''}
      GROUP BY DATE_FORMAT(timestamp, '%Y-%m-%d')
      ORDER BY date ASC
    `, latestParams);

    // Chart 2: Approval Speed (Horizontal Bar Chart)
    const [speedRows] = await dbPool.query(`
      SELECT approval_stage as stage, ROUND(AVG(decision_time_seconds)/60, 1) as avg_mins
      FROM approval_history
      WHERE decision_time_seconds > 0
      GROUP BY approval_stage
    `);

    // Chart 3: Monthly Requests
    const [monthlyRows] = await dbPool.query(`
      SELECT DATE_FORMAT(created_at, '%b %Y') as month, COUNT(*) as count
      FROM workflow_requests
      GROUP BY DATE_FORMAT(created_at, '%Y-%m'), DATE_FORMAT(created_at, '%b %Y')
      ORDER BY MIN(created_at) ASC
    `);

    // Chart 4: Workflow Funnel (using current_role instead of non-existent approval_stage)
    const [funnelRows] = await dbPool.query(`
      SELECT COALESCE(current_role, 'Accounts') as stage, COUNT(*) as count
      FROM workflow_requests
      GROUP BY stage
    `);

    const [pendingRequests] = await dbPool.query(`
      SELECT * FROM workflow_requests
      WHERE LOWER(status) LIKE 'pending%'
      ORDER BY id DESC
    `);

    const highestAmountApproved = highestApprovedAmount;
    const lowestAmountApproved = lowestApprovedAmount;

    const roleApproved = isFilteredByRole ? decApproved : approvedCount;
    const roleRejected = isFilteredByRole ? decRejected : rejectedCount;
    const rolePending = isFilteredByRole ? managerPending : overallPending;

    res.json({
      kpis: {
        managerPending,
        overallPending,
        pending: rolePending,
        approved: roleApproved,
        rejected: roleRejected,
        total: totalRequests,
        escalated: escalatedCount,
        approvalRate,
        avgDecisionTimeMins
      },
      managerPending,
      overallPending,
      approved: roleApproved,
      rejected: roleRejected,
      pending: rolePending,
      totalRequests,
      escalated: escalatedCount,
      approvalRate,
      avgDecisionTimeMins,
      totalDecisions,
      topDepartment,
      mostActiveDay,
      highestAmountApproved,
      lowestAmountApproved,
      highestApprovedAmount,
      lowestApprovedAmount,
      avgApprovedAmount,
      totalApprovedBudget,
      history: historyRows,
      recentDecisions: historyRows.slice(0, 10),
      pendingRequests,
      charts: {
        trend: trendRows,
        statusDistribution: { pending: rolePending, managerPending, approved: roleApproved, rejected: roleRejected, escalated: 0 },
        approvalSpeed: speedRows,
        monthlyRequests: monthlyRows,
        workflowFunnel: funnelRows
      }
    });
  } catch (err) {
    console.error('GET /api/manager/analytics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get(['/approval-history', '/api/approval-history'], async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ error: 'Database unavailable' });
  }

  try {
    const queryRole = req.query.role || (req.user ? req.user.role : null);
    let query = `
      SELECT ah.*, 
             wr.requester_name AS wr_requester_name, 
             wr.requester_email AS wr_requester_email, 
             wr.department AS wr_department, 
             wr.type AS wr_type, 
             wr.amount AS wr_amount,
             wr.title AS wr_title
      FROM approval_history ah
      LEFT JOIN workflow_requests wr ON ah.request_id = wr.id
      ORDER BY ah.id DESC LIMIT 100
    `;
    let params = [];

    if (queryRole) {
      const role = String(queryRole).toLowerCase().trim();
      query = `
        SELECT ah.*, 
               wr.requester_name AS wr_requester_name, 
               wr.requester_email AS wr_requester_email, 
               wr.department AS wr_department, 
               wr.type AS wr_type, 
               wr.amount AS wr_amount,
               wr.title AS wr_title
        FROM approval_history ah
        LEFT JOIN workflow_requests wr ON ah.request_id = wr.id
        WHERE LOWER(ah.approval_stage) = LOWER(?) OR LOWER(ah.manager_name) = LOWER(?)
        ORDER BY ah.id DESC LIMIT 100
      `;
      params = [role, role];
    }

    const [rows] = await dbPool.query(query, params);
    const [allReqs] = await dbPool.query('SELECT id, requester_email, requester_name FROM workflow_requests ORDER BY id ASC');

    const userSeqMap = new Map();
    const reqsByUser = new Map();
    (allReqs || []).forEach(r => {
      const key = String(r.requester_email || r.requester_name || 'Employee').toLowerCase().trim();
      if (!reqsByUser.has(key)) reqsByUser.set(key, []);
      reqsByUser.get(key).push(r);
    });
    reqsByUser.forEach((userReqs) => {
      userReqs.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
      userReqs.forEach((r, idx) => {
        userSeqMap.set(String(r.id), idx + 1);
      });
    });

    const enrichedRows = rows.map(r => {
      const rawEmail = String(r.wr_requester_email || '').toLowerCase().trim();
      let empName = r.employee_name && r.employee_name !== 'Employee' ? r.employee_name : (r.wr_requester_name && r.wr_requester_name !== 'Employee' ? r.wr_requester_name : '');
      if (!empName || empName === 'Employee' || empName === 'undefined') {
        if (rawEmail.includes('employee1')) empName = 'Gokul';
        else if (rawEmail.includes('employee3') || rawEmail.includes('employee2')) empName = 'Ravi';
        else empName = 'Employee';
      }

      let empId = rawEmail.includes('employee1') ? 'EMP-01' : (rawEmail.includes('employee3') || rawEmail.includes('employee2') ? 'EMP-02' : 'EMP-01');
      const seqNum = userSeqMap.get(String(r.request_id)) || r.request_id;

      let mgrName = r.manager_name;
      if (!mgrName || mgrName === 'Employee' || mgrName === 'undefined') {
        mgrName = r.approval_stage || 'Manager';
      }

      return {
        ...r,
        employee_name: empName,
        employeeName: empName,
        employee_id: empId,
        employeeId: empId,
        seq_num: seqNum,
        seqNum: seqNum,
        manager_name: mgrName,
        managerName: mgrName,
        department: r.department || r.wr_department || 'Administration',
        request_type: r.request_type || r.wr_type || r.wr_title || 'Training'
      };
    });

    res.json(enrichedRows);
  } catch (err) {
    console.error('GET /approval-history failed:', err.message);
    res.json([]);
  }
});

app.post('/history', async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ error: 'Database unavailable' });
  }

  try {
    const { request_id, action, performed_by } = req.body || {};
    const normalizedRequestId = Number(request_id);
    if (!Number.isInteger(normalizedRequestId) || normalizedRequestId <= 0) {
      return res.status(400).json({ error: 'Invalid request_id' });
    }

    const [requestRows] = await dbPool.execute(
      'SELECT id FROM workflow_requests WHERE id = ? LIMIT 1',
      [normalizedRequestId]
    );
    if (!Array.isArray(requestRows) || requestRows.length === 0) {
      return res.status(400).json({ error: 'request_id must be a valid workflow_requests.id' });
    }

    const performer = performed_by || req.user?.name || req.user?.email || 'User';

    await dbPool.execute(
      `INSERT INTO request_history (request_id, action, performed_by)
       VALUES (?, ?, ?)`,
      [normalizedRequestId, action || 'Updated history', performer]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('History insert error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/history/:requestId', async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ error: 'Database unavailable' });
  }

  try {
    const requestId = Number(req.params.requestId);
    const [rows] = await dbPool.execute(
      'SELECT * FROM request_history WHERE request_id = ? ORDER BY id ASC',
      [requestId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Direct login endpoint (mirrors /api/auth/login for compatibility)
app.post('/login', async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ success: false, error: 'Database unavailable' });
  }

  try {
    const { email, password } = req.body || {};

    const [rows] = await dbPool.execute(
      'SELECT * FROM users WHERE email = ? AND password = ?',
      [email, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = rows[0];
    const isAdmin = String(user.role || '').toLowerCase() === 'admin';
    const hasRecoveryEmail =
      isAdmin ||
      Boolean(user.recovery_email && String(user.recovery_email).trim().length > 0);

    res.json({
      success: true,
      hasRecoveryEmail,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        employee_id: user.employee_id,
        department: user.department || '',
        hasRecoveryEmail
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/api/auth/recovery-email', '/recovery-email', '/api/recovery-email'], async (req, res, next) => {
  try {
    const { userId, recoveryEmail } = req.body || {};

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

    const [result] = await db.promise().execute(
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
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/test-db', async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ message: 'DB Error: Database unavailable' });
  }

  try {
    await dbPool.query('SELECT 1');
    res.json({ message: 'DB Working' });
  } catch (error) {
    res.status(500).json({ message: `DB Error: ${error.message}` });
  }
});

app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Server error' });
});

// Start Server on PORT 4000 (or process.env.PORT) with auto port recovery
initializeMysqlStorage().finally(() => {
  const PORT = Number(process.env.PORT || 4000);

  function listenOnPort(port) {
    const server = app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[SERVER WARNING] Port ${port} is occupied. Releasing port ${port}...`);
        try {
          const { execSync } = require('child_process');
          execSync(`npx -y kill-port ${port}`, { stdio: 'ignore' });
        } catch (killErr) { }

        setTimeout(() => {
          app.listen(port, () => {
            console.log(`Server successfully started on port ${port}`);
          });
        }, 1000);
      } else {
        console.error('Server error:', err);
      }
    });
  }

  listenOnPort(PORT);
});
