const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mysql = require('mysql2');
const pool = require('./config/db');

// Import Auth Middleware & Demo Session Middleware
const authMiddleware = require('./middleware/authMiddleware');
const { optionalAuth } = require('./middleware/authMiddleware');
const demoSessionMiddleware = require('./middleware/demoSessionMiddleware');
const { seedDemoSession } = require('./utils/demoSeeder');

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

// Apply Demo Session Middleware to all incoming requests
app.use(demoSessionMiddleware);

// Helper to get active demo session ID
function getSessionId(req) {
  if (!pool.isDemoMode) return null;
  return req?.demoSessionId || req?.user?.demo_session_id || 'default';
}

/**
 * Initialize MySQL Database Schema
 * Automatically manages schema for both Production (zyroflow) and Demo (zyroflow_demo).
 */
async function initializeMysqlStorage() {
  try {
    const isDemo = pool.isDemoMode;
    const database = pool.databaseName;

    console.log(`[DB INIT] Initializing MySQL Database: ${database} (Mode: ${isDemo ? 'DEMO' : 'PRODUCTION'})...`);

    const host = process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost';
    const port = Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306);
    const user = process.env.MYSQL_USER || process.env.DB_USER || 'root';
    const configuredPassword = process.env.MYSQL_PASSWORD !== undefined ? process.env.MYSQL_PASSWORD : (process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : 'root123');

    const tempConn = await mysql.createConnection({
      host,
      port,
      user,
      password: configuredPassword,
      ssl: process.env.MYSQL_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
      multipleStatements: true
    }).promise();

    await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
    await tempConn.query(`USE \`${database}\``);

    await tempConn.execute('SET FOREIGN_KEY_CHECKS = 0');
    await tempConn.execute('DROP TABLE IF EXISTS requests');
    await tempConn.execute('SET FOREIGN_KEY_CHECKS = 1');

    if (isDemo) {
      // Create Demo Schema with demo_session_id
      await tempConn.execute(`
        CREATE TABLE IF NOT EXISTS workflow_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
          title VARCHAR(255),
          type VARCHAR(100),
          description TEXT,
          amount INT,
          department VARCHAR(100),
          priority VARCHAR(50),
          status VARCHAR(50),
          requester_name VARCHAR(100),
          requester_email VARCHAR(100),
          \`current_role\` VARCHAR(50),
          current_approver VARCHAR(100),
          approval_stage VARCHAR(100) DEFAULT 'Accounts',
          workflow TEXT,
          payload JSON NULL,
          current_level INT DEFAULT 0,
          payment_verified INT DEFAULT 0,
          payment_verified_by VARCHAR(100) NULL,
          payment_verified_at TIMESTAMP NULL,
          payment_verification_status VARCHAR(50) DEFAULT 'Unverified',
          rejection_reason TEXT NULL,
          comments TEXT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_demo_session (demo_session_id),
          INDEX idx_req_status (status)
        )
      `);

      await tempConn.execute(`
        CREATE TABLE IF NOT EXISTS approvals (
          id INT AUTO_INCREMENT PRIMARY KEY,
          demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
          request_id INT NOT NULL,
          approver_role VARCHAR(50),
          step INT,
          status VARCHAR(50),
          comments TEXT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_demo_session (demo_session_id),
          INDEX idx_appr_req (request_id)
        )
      `);

      await tempConn.execute(`
        CREATE TABLE IF NOT EXISTS rules (
          id INT AUTO_INCREMENT PRIMARY KEY,
          demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
          request_type VARCHAR(100),
          min_amount DECIMAL(12,2) DEFAULT 0,
          max_amount DECIMAL(12,2) DEFAULT 0,
          approvers TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_demo_session (demo_session_id)
        )
      `);

      await tempConn.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
          employee_id VARCHAR(20) NOT NULL,
          name VARCHAR(100),
          email VARCHAR(100) NULL,
          password VARCHAR(255),
          role VARCHAR(50),
          phone VARCHAR(20),
          department VARCHAR(100),
          profile_image VARCHAR(255),
          status VARCHAR(20) DEFAULT 'ACTIVE',
          recovery_email VARCHAR(255) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_demo_session (demo_session_id),
          UNIQUE KEY uq_emp_session (employee_id, demo_session_id),
          UNIQUE KEY uq_email_session (email, demo_session_id)
        )
      `);

      await tempConn.execute(`
        CREATE TABLE IF NOT EXISTS approval_history (
          id INT AUTO_INCREMENT PRIMARY KEY,
          demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
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
          comments TEXT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_demo_session (demo_session_id),
          INDEX idx_ah_req (request_id)
        )
      `);

      await tempConn.execute(`
        CREATE TABLE IF NOT EXISTS payment_verifications (
          id INT AUTO_INCREMENT PRIMARY KEY,
          demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
          request_id INT NOT NULL,
          verified_by VARCHAR(100) NOT NULL,
          verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          remarks TEXT,
          status VARCHAR(50) DEFAULT 'Verified',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_demo_session (demo_session_id),
          INDEX idx_pv_req (request_id)
        )
      `);

      await tempConn.execute(`
        CREATE TABLE IF NOT EXISTS notifications (
          id INT AUTO_INCREMENT PRIMARY KEY,
          demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
          user_role VARCHAR(50) DEFAULT 'accounts',
          user_email VARCHAR(100) NULL,
          request_id INT NULL,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          type VARCHAR(50) DEFAULT 'info',
          is_read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_demo_session (demo_session_id)
        )
      `);

      await tempConn.execute(`
        CREATE TABLE IF NOT EXISTS draft_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
          employee_id VARCHAR(100) NOT NULL,
          request_type VARCHAR(100),
          department VARCHAR(100),
          priority VARCHAR(50),
          payload JSON NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_demo_session (demo_session_id)
        )
      `);

      await tempConn.execute(`
        CREATE TABLE IF NOT EXISTS request_history (
          id INT AUTO_INCREMENT PRIMARY KEY,
          demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
          request_id BIGINT,
          action VARCHAR(255),
          performed_by VARCHAR(100),
          comments TEXT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_demo_session (demo_session_id)
        )
      `);

      await tempConn.execute(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id INT AUTO_INCREMENT PRIMARY KEY,
          demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
          user_id INT NOT NULL,
          token_hash VARCHAR(255) NOT NULL,
          expires_at DATETIME NOT NULL,
          used_at DATETIME NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_demo_session (demo_session_id)
        )
      `);

      await tempConn.execute(`
        CREATE TABLE IF NOT EXISTS demo_access (
          id INT AUTO_INCREMENT PRIMARY KEY,
          demo_session_id VARCHAR(64) NOT NULL,
          employee_id VARCHAR(50) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL DEFAULT 'Admin',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL,
          status VARCHAR(20) DEFAULT 'ACTIVE',
          INDEX idx_demo_emp (employee_id),
          INDEX idx_demo_session (demo_session_id),
          INDEX idx_demo_status (status)
        )
      `);

      // Seed default demo session if enabled
      if (process.env.DEMO_SEED === 'true') {
        await seedDemoSession(pool, 'default');
      }
    } else {
      // Production Schema Initialization
      await tempConn.execute(`
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
          \`current_role\` VARCHAR(50),
          current_approver VARCHAR(100),
          approval_stage VARCHAR(100) DEFAULT 'Accounts',
          workflow TEXT,
          payload JSON NULL,
          current_level INT DEFAULT 0,
          payment_verified INT DEFAULT 0,
          payment_verified_by VARCHAR(100) NULL,
          payment_verified_at TIMESTAMP NULL,
          payment_verification_status VARCHAR(50) DEFAULT 'Unverified',
          rejection_reason TEXT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      await tempConn.execute(`
        CREATE TABLE IF NOT EXISTS approvals (
          id INT AUTO_INCREMENT PRIMARY KEY,
          request_id INT,
          approver_role VARCHAR(50),
          step INT,
          status VARCHAR(50),
          comments TEXT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (request_id) REFERENCES workflow_requests(id) ON DELETE CASCADE
        )
      `);

      await tempConn.execute(`
        CREATE TABLE IF NOT EXISTS rules (
          id INT AUTO_INCREMENT PRIMARY KEY,
          request_type VARCHAR(100),
          min_amount DECIMAL(12,2) DEFAULT 0,
          max_amount DECIMAL(12,2) DEFAULT 0,
          approvers TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await tempConn.query(`
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          employee_id VARCHAR(20) UNIQUE,
          name VARCHAR(100),
          email VARCHAR(100) NULL,
          password VARCHAR(255),
          role VARCHAR(50),
          phone VARCHAR(20),
          department VARCHAR(100),
          profile_image VARCHAR(255),
          status VARCHAR(20) DEFAULT 'ACTIVE',
          recovery_email VARCHAR(255) NULL
        )
      `);

      await tempConn.execute(`
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
          comments TEXT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_ah_req (request_id),
          INDEX idx_ah_stage (approval_stage)
        )
      `);

      await tempConn.execute(`
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

      await tempConn.execute(`
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

      await tempConn.execute(`
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

      await tempConn.query(`
        CREATE TABLE IF NOT EXISTS request_history (
          id INT AUTO_INCREMENT PRIMARY KEY,
          request_id BIGINT,
          action VARCHAR(255),
          performed_by VARCHAR(100),
          comments TEXT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await tempConn.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          token_hash VARCHAR(255) NOT NULL,
          expires_at DATETIME NOT NULL,
          used_at DATETIME NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await tempConn.execute(`
        CREATE TABLE IF NOT EXISTS demo_access (
          id INT AUTO_INCREMENT PRIMARY KEY,
          demo_session_id VARCHAR(64) NOT NULL,
          employee_id VARCHAR(50) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL DEFAULT 'Admin',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL,
          status VARCHAR(20) DEFAULT 'ACTIVE',
          INDEX idx_demo_emp (employee_id),
          INDEX idx_demo_session (demo_session_id),
          INDEX idx_demo_status (status)
        )
      `);
    }

    // Automatic Migration: Ensure account_type column exists on users and demo_access
    try {
      await tempConn.execute(`ALTER TABLE users ADD COLUMN account_type VARCHAR(50) NULL DEFAULT NULL`);
    } catch (acctErr) {}
    try {
      await tempConn.execute(`ALTER TABLE demo_access ADD COLUMN account_type VARCHAR(50) NULL DEFAULT NULL`);
    } catch (acctErr2) {}

    // Automatic Migration: Ensure email column is nullable
    try {
      await tempConn.execute(`ALTER TABLE users MODIFY COLUMN email VARCHAR(150) NULL DEFAULT NULL`);
    } catch (emailMigErr) {}

    // Automatic Migration: Ensure approver roles (Accounts, Manager, CFO, MD) have department = 'All Departments'
    try {
      await tempConn.execute(`
        UPDATE users 
        SET department = 'All Departments' 
        WHERE LOWER(role) IN ('accounts', 'manager', 'cfo', 'md')
      `);
    } catch (migErr) {
      console.warn('[DB INIT] Approver department migration note:', migErr.message);
    }

    // Automatic Migration: Set default account_type for admins
    try {
      if (isDemo) {
        await tempConn.execute(`
          UPDATE users 
          SET account_type = 'DEMO_OWNER' 
          WHERE LOWER(role) = 'admin' AND NOT (LOWER(employee_id) LIKE 'demo-%')
        `);
        await tempConn.execute(`
          UPDATE users 
          SET account_type = 'TEMPORARY_DEMO_ADMIN' 
          WHERE LOWER(employee_id) LIKE 'demo-%'
        `);
        await tempConn.execute(`
          UPDATE demo_access 
          SET account_type = 'TEMPORARY_DEMO_ADMIN' 
          WHERE account_type IS NULL OR account_type = ''
        `);
      } else {
        await tempConn.execute(`
          UPDATE users 
          SET account_type = 'PRODUCTION_ADMIN' 
          WHERE LOWER(role) = 'admin'
        `);
      }
    } catch (acctTypeMigErr) {
      console.warn('[DB INIT] Account type migration note:', acctTypeMigErr.message);
    }

    await tempConn.end();
    console.log(`[DB INIT] Database tables ready for ${database}.`);
  } catch (err) {
    console.error('[DB INIT] Error initializing database:', err.message);
  }
}

// Serve frontend static files
app.use(express.static('frontend'));

// Mount Modular API Routes
app.use('/api/auth', authRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api', approvalsRoutes);
app.use('/', approvalsRoutes);
app.use('/api', trackRoutes);
app.use('/', trackRoutes);
app.use('/api', profileRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/accounts', accountsRoutes);
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
  const workflow = getWorkflowList(row);
  const payload = parseJsonValue(row.payload, {});
  const createdAt = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : createdAt;
  const currentLevel = Number(row.current_level ?? 0);
  const currentRole = row.current_role || workflow[Math.min(currentLevel, Math.max(workflow.length - 1, 0))] || '';
  const currentApprover = row.current_approver || currentRole || '';
  const approvalStage = row.approval_stage || currentRole || '';

  const isVerified = Number(row.payment_verified ?? 0) === 1 || String(row.payment_verification_status || '').toLowerCase() === 'verified';

  return {
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
}

async function getApprovalChain(type, amount, customWorkflow, sessionId) {
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

  try {
    const cleanType = String(type || '').trim().toLowerCase();
    const isLeave = cleanType === 'leave request' || cleanType === 'leave';
    const numAmt = Number(amount || 0);

    let rules = [];
    if (pool.isDemoMode && sessionId) {
      if (isLeave || numAmt === 0) {
        const [res] = await pool.execute(
          'SELECT * FROM rules WHERE demo_session_id = ? AND LOWER(TRIM(request_type)) = LOWER(TRIM(?)) ORDER BY id DESC LIMIT 1',
          [sessionId, type]
        );
        rules = res;
      }
      if (!rules || rules.length === 0) {
        const [res] = await pool.execute(
          'SELECT * FROM rules WHERE demo_session_id = ? AND LOWER(TRIM(request_type)) = LOWER(TRIM(?)) AND ? >= min_amount AND (max_amount IS NULL OR max_amount = 0 OR ? <= max_amount) ORDER BY min_amount DESC LIMIT 1',
          [sessionId, type, numAmt, numAmt]
        );
        rules = res;
      }
    } else {
      if (isLeave || numAmt === 0) {
        const [res] = await pool.execute(
          'SELECT * FROM rules WHERE LOWER(TRIM(request_type)) = LOWER(TRIM(?)) ORDER BY id DESC LIMIT 1',
          [type]
        );
        rules = res;
      }
      if (!rules || rules.length === 0) {
        const [res] = await pool.execute(
          'SELECT * FROM rules WHERE LOWER(TRIM(request_type)) = LOWER(TRIM(?)) AND ? >= min_amount AND (max_amount IS NULL OR max_amount = 0 OR ? <= max_amount) ORDER BY min_amount DESC LIMIT 1',
          [type, numAmt, numAmt]
        );
        rules = res;
      }
    }

    if (rules && rules.length > 0 && rules[0].approvers) {
      const ruleChain = String(rules[0].approvers).split(',').map(s => s.trim()).filter(Boolean);
      chain = sanitizeApprovers(ruleChain);
    }
  } catch (err) {
    console.error('[getApprovalChain] Error querying rules:', err.message);
  }

  if (chain.length === 0 && customWorkflow) {
    const parsed = parseJsonValue(customWorkflow, []);
    chain = sanitizeApprovers(parsed);
  }

  if (chain.length === 3 && chain[0] === 'Accounts' && chain[1] === 'Manager' && chain[2] === 'CFO') {
    chain = ['Accounts', 'Manager', 'CFO', 'MD'];
  }

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

// ==========================================
// UNIFIED /requests ENDPOINTS
// ==========================================

/**
 * GET /requests & /api/requests
 */
app.get(['/requests', '/api/requests'], optionalAuth, async (req, res) => {
  try {
    const user = req.user;
    const queryRole = req.query.role || null;
    const sessionId = getSessionId(req);

    let query = 'SELECT * FROM workflow_requests';
    let params = [];

    const conditions = [];

    if (pool.isDemoMode && sessionId) {
      conditions.push('demo_session_id = ?');
      params.push(sessionId);
    }

    if (queryRole) {
      const role = String(queryRole).toLowerCase().trim();
      if (role === 'employee') {
        conditions.push('(LOWER(requester_email) = LOWER(?) OR LOWER(requester_name) = LOWER(?))');
        params.push(user?.email || '', user?.name || '');
      } else if (['manager', 'accounts', 'cfo', 'md'].includes(role)) {
        const statusMatch = `pending ${role} approval`;
        const extraMdCondition = role === 'md' ? "OR LOWER(status) LIKE '%cfo%' OR LOWER(status) LIKE '%escalat%'" : "";
        conditions.push(`(
          LOWER(status) = LOWER(?)
          OR (
            (LOWER(status) = 'pending' OR LOWER(status) LIKE 'pending%' ${extraMdCondition})
            AND (
              LOWER(current_approver) = LOWER(?)
              OR LOWER(current_role) = LOWER(?)
              OR LOWER(approval_stage) = LOWER(?)
            )
          )
          ${role === 'md' ? "OR LOWER(status) LIKE '%escalat%' OR LOWER(status) LIKE '%cfo forwarded%' OR LOWER(status) LIKE '%cfo approved%'" : ""}
        )`);
        params.push(statusMatch, role, role, role);
      }
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ' ORDER BY id DESC';

    const [rows] = await pool.query(query, params);

    const allReqsSql = pool.isDemoMode && sessionId
      ? 'SELECT id, requester_email, requester_name FROM workflow_requests WHERE demo_session_id = ? ORDER BY id ASC'
      : 'SELECT id, requester_email, requester_name FROM workflow_requests ORDER BY id ASC';
    const allReqsParams = pool.isDemoMode && sessionId ? [sessionId] : [];

    const [allReqs] = await pool.query(allReqsSql, allReqsParams);

    const allUsersSql = pool.isDemoMode && sessionId
      ? 'SELECT id, employee_id, name, email FROM users WHERE demo_session_id = ?'
      : 'SELECT id, employee_id, name, email FROM users';
    const allUsersParams = pool.isDemoMode && sessionId ? [sessionId] : [];

    const [allUsers] = await pool.query(allUsersSql, allUsersParams);

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

    const historyByReqId = new Map();
    try {
      const histSql = pool.isDemoMode && sessionId
        ? 'SELECT id, request_id, action, performed_by, timestamp, comments FROM request_history WHERE demo_session_id = ? ORDER BY id ASC'
        : 'SELECT id, request_id, action, performed_by, timestamp, comments FROM request_history ORDER BY id ASC';
      const histParams = pool.isDemoMode && sessionId ? [sessionId] : [];

      const [allHist] = await pool.query(histSql, histParams);
      (allHist || []).forEach(h => {
        const reqId = Number(h.request_id);
        if (!historyByReqId.has(reqId)) historyByReqId.set(reqId, []);
        historyByReqId.get(reqId).push(h);
      });
    } catch (e) {}

    const data = rows.map(r => {
      const mapped = mapRequestRow(r);
      const seq = userSeqMap.get(Number(r.id)) || Number(r.id);
      const u = userMap.get(String(r.requester_email || '').toLowerCase().trim());
      const empId = u?.employee_id || (String(r.requester_email).includes('employee1') ? 'EMP-01' : 'EMP-01');
      const empName = u?.name || r.requester_name || 'Employee';
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
 */
app.get(['/requests/:id', '/api/requests/:id'], optionalAuth, async (req, res) => {
  try {
    const requestId = Number(req.params.id);
    const sessionId = getSessionId(req);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ message: 'Invalid request id' });
    }

    const sql = pool.isDemoMode && sessionId
      ? `SELECT * FROM workflow_requests WHERE demo_session_id = ? AND id = ? LIMIT 1`
      : `SELECT * FROM workflow_requests WHERE id = ? LIMIT 1`;
    const params = pool.isDemoMode && sessionId ? [sessionId, requestId] : [requestId];

    const [rows] = await pool.execute(sql, params);
    if (!rows.length) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const requestData = mapRequestRow(rows[0]);

    if (req.user && String(req.user.role).toLowerCase() === 'employee') {
      const userEmail = String(req.user.email || '').toLowerCase();
      const reqEmail = String(requestData.requester_email || '').toLowerCase();
      if (reqEmail && userEmail && reqEmail !== userEmail) {
        return res.status(403).json({ message: 'Access denied to this request' });
      }
    }

    try {
      const apprSql = pool.isDemoMode && sessionId
        ? `SELECT id, step, approver_role, status, updated_at, comments FROM approvals WHERE demo_session_id = ? AND request_id = ? ORDER BY step ASC`
        : `SELECT id, step, approver_role, status, updated_at, comments FROM approvals WHERE request_id = ? ORDER BY step ASC`;
      const apprParams = pool.isDemoMode && sessionId ? [sessionId, requestId] : [requestId];

      const [approvalRows] = await pool.execute(apprSql, apprParams);
      requestData.timeline = approvalRows;
      requestData.approvals = approvalRows;
    } catch (e) {
      requestData.timeline = [];
      requestData.approvals = [];
    }

    try {
      const histSql = pool.isDemoMode && sessionId
        ? `SELECT id, action, performed_by, timestamp FROM request_history WHERE demo_session_id = ? AND request_id = ? ORDER BY id ASC`
        : `SELECT id, action, performed_by, timestamp FROM request_history WHERE request_id = ? ORDER BY id ASC`;
      const histParams = pool.isDemoMode && sessionId ? [sessionId, requestId] : [requestId];
      const [historyRows] = await pool.execute(histSql, histParams);

      const appHistSql = pool.isDemoMode && sessionId
        ? `SELECT id, manager_name, approval_stage, decision, action, decision_timestamp, timestamp, comments FROM approval_history WHERE demo_session_id = ? AND request_id = ? ORDER BY id ASC`
        : `SELECT id, manager_name, approval_stage, decision, action, decision_timestamp, timestamp, comments FROM approval_history WHERE request_id = ? ORDER BY id ASC`;
      const appHistParams = pool.isDemoMode && sessionId ? [sessionId, requestId] : [requestId];
      const [appHistRows] = await pool.execute(appHistSql, appHistParams);

      requestData.history = historyRows;
      requestData.approval_history = appHistRows;
    } catch (e) {
      requestData.history = [];
      requestData.approval_history = [];
    }

    try {
      const payloadObj = typeof requestData.payload === 'string' ? JSON.parse(requestData.payload) : (requestData.payload || {});
      requestData.attachments = payloadObj.attachments || payloadObj.files || (payloadObj.attachment ? [payloadObj.attachment] : []);
    } catch (e) {
      requestData.attachments = [];
    }

    res.json(requestData);
  } catch (error) {
    console.error('GET /requests/:id failed:', error.message);
    res.status(500).json({ message: 'Failed to fetch request' });
  }
});

/**
 * POST /requests or /api/requests
 */
app.post(['/requests', '/api/requests'], optionalAuth, async (req, res) => {
  try {
    const user = req.user || {};
    const input = req.body || {};
    const sessionId = getSessionId(req);

    const type = input.request_type || input.type || input.title || 'general';
    const amount = Number(input.amount ?? 0);

    const approverChain = await getApprovalChain(type, amount, input.workflow, sessionId);
    const firstApprover = approverChain[0] || 'Accounts';
    const initialStatus = `Pending ${firstApprover} Approval`;

    const requestData = normalizeRequestInput({
      ...input,
      workflow: JSON.stringify(approverChain),
      current_role: firstApprover,
      current_approver: firstApprover,
      approval_stage: firstApprover,
      current_level: 0,
      status: initialStatus
    }, user);

    let requestId;

    if (pool.isDemoMode && sessionId) {
      const [result] = await pool.execute(
        `INSERT INTO workflow_requests
         (demo_session_id, title, type, description, amount, department, priority, status, approval_stage, requester_name, requester_email, current_role, current_approver, workflow, payload, current_level)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
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
      requestId = result.insertId;

      const draftId = req.body.draft_id || req.body.draftId || (req.body.payload && (req.body.payload.draft_id || req.body.payload.draftId));
      if (draftId) {
        await pool.execute('DELETE FROM draft_requests WHERE demo_session_id = ? AND id = ?', [sessionId, draftId]).catch(() => { });
      }
      if (requestData.requester_email) {
        await pool.execute(
          'DELETE FROM draft_requests WHERE demo_session_id = ? AND LOWER(employee_id) = LOWER(?) AND LOWER(request_type) = LOWER(?)',
          [sessionId, requestData.requester_email, requestData.type || '']
        ).catch(() => { });
      }

      for (let i = 0; i < approverChain.length; i += 1) {
        await pool.execute(
          `INSERT INTO approvals (demo_session_id, request_id, approver_role, step, status)
           VALUES (?, ?, ?, ?, ?)`,
          [
            sessionId,
            requestId,
            approverChain[i],
            i,
            i === 0 ? 'pending' : 'waiting'
          ]
        );
      }

      await pool.execute(
        `INSERT INTO request_history (demo_session_id, request_id, action, performed_by)
         VALUES (?, ?, ?, ?)`,
        [sessionId, requestId, 'Created request', requestData.requester_name]
      );

      if (requestData.requester_email) {
        await pool.execute(
          `INSERT INTO notifications (demo_session_id, user_email, user_role, request_id, title, message, type)
           VALUES (?, ?, 'employee', ?, 'Request Submitted', 'Request submitted successfully.', 'success')`,
          [sessionId, requestData.requester_email, requestId]
        ).catch(() => { });
      }

      await pool.execute(
        `INSERT INTO notifications (demo_session_id, user_role, request_id, title, message, type)
         VALUES (?, 'accounts', ?, 'New Request', 'New request submitted.', 'info')`,
        [sessionId, requestId]
      ).catch(() => { });

      const [createdRows] = await pool.execute('SELECT * FROM workflow_requests WHERE demo_session_id = ? AND id = ? LIMIT 1', [sessionId, requestId]);
      const createdRequest = mapRequestRow(createdRows[0]);

      return res.status(201).json({
        success: true,
        id: requestId,
        request_id: requestId,
        request: createdRequest
      });
    } else {
      const [result] = await pool.execute(
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
      requestId = result.insertId;

      const draftId = req.body.draft_id || req.body.draftId || (req.body.payload && (req.body.payload.draft_id || req.body.payload.draftId));
      if (draftId) {
        await pool.execute('DELETE FROM draft_requests WHERE id = ?', [draftId]).catch(() => { });
      }
      if (requestData.requester_email) {
        await pool.execute(
          'DELETE FROM draft_requests WHERE LOWER(employee_id) = LOWER(?) AND LOWER(request_type) = LOWER(?)',
          [requestData.requester_email, requestData.type || '']
        ).catch(() => { });
      }

      for (let i = 0; i < approverChain.length; i += 1) {
        await pool.execute(
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

      await pool.execute(
        `INSERT INTO request_history (request_id, action, performed_by)
         VALUES (?, ?, ?)`,
        [requestId, 'Created request', requestData.requester_name]
      );

      if (requestData.requester_email) {
        await pool.execute(
          `INSERT INTO notifications (user_email, user_role, request_id, title, message, type)
           VALUES (?, 'employee', ?, 'Request Submitted', 'Request submitted successfully.', 'success')`,
          [requestData.requester_email, requestId]
        ).catch(() => { });
      }

      await pool.execute(
        `INSERT INTO notifications (user_role, request_id, title, message, type)
         VALUES ('accounts', ?, 'New Request', 'New request submitted.', 'info')`,
        [requestId]
      ).catch(() => { });

      const [createdRows] = await pool.execute('SELECT * FROM workflow_requests WHERE id = ? LIMIT 1', [requestId]);
      const createdRequest = mapRequestRow(createdRows[0]);

      return res.status(201).json({
        success: true,
        id: requestId,
        request_id: requestId,
        request: createdRequest
      });
    }
  } catch (err) {
    console.error('POST /requests failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /requests/:id
 */
app.put('/requests/:id', optionalAuth, async (req, res) => {
  try {
    const requestId = Number(req.params.id);
    const sessionId = getSessionId(req);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid request id' });
    }

    const checkSql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM workflow_requests WHERE demo_session_id = ? AND id = ? LIMIT 1'
      : 'SELECT * FROM workflow_requests WHERE id = ? LIMIT 1';
    const checkParams = pool.isDemoMode && sessionId ? [sessionId, requestId] : [requestId];

    const [rows] = await pool.execute(checkSql, checkParams);
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    const existing = mapRequestRow(rows[0]);
    if (!String(existing.status || '').toLowerCase().includes('pending')) {
      return res.status(409).json({ success: false, error: 'Only pending requests can be edited' });
    }

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
    const approverChain = await getApprovalChain(updateData.type, updateData.amount, req.body.workflow, sessionId);
    const firstApprover = approverChain[0] || 'Accounts';
    const newStatus = `Pending ${firstApprover} Approval`;

    const upSql = pool.isDemoMode && sessionId
      ? `UPDATE workflow_requests
         SET title = ?, type = ?, description = ?, amount = ?, department = ?, priority = ?, status = ?, approval_stage = ?, requester_name = ?, requester_email = ?, current_role = ?, current_approver = ?, workflow = ?, payload = ?, current_level = 0
         WHERE demo_session_id = ? AND id = ?`
      : `UPDATE workflow_requests
         SET title = ?, type = ?, description = ?, amount = ?, department = ?, priority = ?, status = ?, approval_stage = ?, requester_name = ?, requester_email = ?, current_role = ?, current_approver = ?, workflow = ?, payload = ?, current_level = 0
         WHERE id = ?`;
    const upParams = pool.isDemoMode && sessionId
      ? [
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
          sessionId,
          requestId,
        ]
      : [
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
        ];

    await pool.execute(upSql, upParams);

    if (pool.isDemoMode && sessionId) {
      await pool.execute('DELETE FROM approvals WHERE demo_session_id = ? AND request_id = ?', [sessionId, requestId]);
      for (let i = 0; i < approverChain.length; i += 1) {
        await pool.execute(
          `INSERT INTO approvals (demo_session_id, request_id, approver_role, step, status)
           VALUES (?, ?, ?, ?, 'pending')`,
          [sessionId, requestId, approverChain[i], i]
        );
      }

      const performer = req.user?.name || req.user?.email || existing.requester || 'User';
      await pool.execute(
        `INSERT INTO request_history (demo_session_id, request_id, action, performed_by) VALUES (?, ?, ?, ?)`,
        [sessionId, requestId, `Updated request amount to ₹${updateData.amount.toLocaleString('en-IN')}`, performer]
      );

      const [updatedRows] = await pool.execute('SELECT * FROM workflow_requests WHERE demo_session_id = ? AND id = ? LIMIT 1', [sessionId, requestId]);
      return res.json({ success: true, request: mapRequestRow(updatedRows[0]) });
    } else {
      await pool.execute('DELETE FROM approvals WHERE request_id = ?', [requestId]);
      for (let i = 0; i < approverChain.length; i += 1) {
        await pool.execute(
          `INSERT INTO approvals (request_id, approver_role, step, status)
           VALUES (?, ?, ?, 'pending')`,
          [requestId, approverChain[i], i]
        );
      }

      const performer = req.user?.name || req.user?.email || existing.requester || 'User';
      await pool.execute(
        `INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)`,
        [requestId, `Updated request amount to ₹${updateData.amount.toLocaleString('en-IN')}`, performer]
      );

      const [updatedRows] = await pool.execute('SELECT * FROM workflow_requests WHERE id = ? LIMIT 1', [requestId]);
      return res.json({ success: true, request: mapRequestRow(updatedRows[0]) });
    }
  } catch (err) {
    console.error('PUT /requests/:id failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /requests/:id/update-photo
 */
app.post(['/requests/:id/update-photo', '/api/requests/:id/update-photo'], optionalAuth, async (req, res) => {
  try {
    const requestId = Number(req.params.id);
    const { photo_url, photoUrl, file_name, fileName } = req.body || {};
    const url = photo_url || photoUrl;
    const name = file_name || fileName || 'Attached Photo';
    const sessionId = getSessionId(req);

    if (!requestId || !url) {
      return res.status(400).json({ success: false, message: 'Valid request_id and photo_url are required' });
    }

    const checkSql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM workflow_requests WHERE demo_session_id = ? AND id = ? LIMIT 1'
      : 'SELECT * FROM workflow_requests WHERE id = ? LIMIT 1';
    const checkParams = pool.isDemoMode && sessionId ? [sessionId, requestId] : [requestId];

    const [rows] = await pool.execute(checkSql, checkParams);
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

    const upSql = pool.isDemoMode && sessionId
      ? 'UPDATE workflow_requests SET payload = ? WHERE demo_session_id = ? AND id = ?'
      : 'UPDATE workflow_requests SET payload = ? WHERE id = ?';
    const upParams = pool.isDemoMode && sessionId
      ? [JSON.stringify(payloadObj), sessionId, requestId]
      : [JSON.stringify(payloadObj), requestId];

    await pool.execute(upSql, upParams);

    const performer = req.user ? (req.user.name || req.user.email) : (reqRow.requester_name || 'Employee');
    if (pool.isDemoMode && sessionId) {
      await pool.execute(
        'INSERT INTO request_history (demo_session_id, request_id, action, performed_by) VALUES (?, ?, ?, ?)',
        [sessionId, requestId, 'Updated attached photo', performer]
      );
    } else {
      await pool.execute(
        'INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)',
        [requestId, 'Updated attached photo', performer]
      );
    }

    const [updatedRows] = await pool.execute(checkSql, checkParams);
    res.json({ success: true, message: 'Photo updated successfully', request: mapRequestRow(updatedRows[0]) });
  } catch (err) {
    console.error('POST /requests/:id/update-photo failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /requests/:id/status
 */
app.patch('/requests/:id/status', optionalAuth, async (req, res) => {
  try {
    const requestId = Number(req.params.id);
    const sessionId = getSessionId(req);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid request id' });
    }

    const newStatus = String(req.body?.status || '').trim().toLowerCase();
    if (!newStatus) {
      return res.status(400).json({ success: false, error: 'status is required' });
    }

    const checkSql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM workflow_requests WHERE demo_session_id = ? AND id = ? LIMIT 1'
      : 'SELECT * FROM workflow_requests WHERE id = ? LIMIT 1';
    const checkParams = pool.isDemoMode && sessionId ? [sessionId, requestId] : [requestId];

    const [rows] = await pool.execute(checkSql, checkParams);
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    const existing = mapRequestRow(rows[0]);
    if (newStatus === 'cancelled' && !String(existing.status || '').toLowerCase().includes('pending')) {
      return res.status(409).json({ success: false, error: 'This request can no longer be cancelled.' });
    }

    const statusToSave = newStatus === 'cancelled' ? 'Cancelled' : req.body.status;
    const upSql = pool.isDemoMode && sessionId
      ? 'UPDATE workflow_requests SET status = ? WHERE demo_session_id = ? AND id = ?'
      : 'UPDATE workflow_requests SET status = ? WHERE id = ?';
    const upParams = pool.isDemoMode && sessionId
      ? [statusToSave, sessionId, requestId]
      : [statusToSave, requestId];

    await pool.execute(upSql, upParams);

    if (newStatus === 'cancelled') {
      const cancelSql = pool.isDemoMode && sessionId
        ? "UPDATE approvals SET status = 'Cancelled' WHERE demo_session_id = ? AND request_id = ? AND LOWER(status) = 'pending'"
        : "UPDATE approvals SET status = 'Cancelled' WHERE request_id = ? AND LOWER(status) = 'pending'";
      const cancelParams = pool.isDemoMode && sessionId ? [sessionId, requestId] : [requestId];
      await pool.execute(cancelSql, cancelParams).catch(() => {});
    }

    const performer = req.user?.name || req.user?.email || existing.requester_name || existing.requester || 'Requester';
    const actionText = newStatus === 'cancelled' ? `Cancelled by ${performer}` : `Status updated to ${newStatus}`;

    if (pool.isDemoMode && sessionId) {
      await pool.execute(
        `INSERT INTO request_history (demo_session_id, request_id, action, performed_by) VALUES (?, ?, ?, ?)`,
        [sessionId, requestId, actionText, performer]
      );
    } else {
      await pool.execute(
        `INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)`,
        [requestId, actionText, performer]
      );
    }

    const [updatedRows] = await pool.execute(checkSql, checkParams);
    res.json({ success: true, request: mapRequestRow(updatedRows[0]) });
  } catch (err) {
    console.error('PATCH /requests/:id/status failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /requests/:id
 */
app.delete('/requests/:id', optionalAuth, async (req, res) => {
  try {
    const requestId = Number(req.params.id);
    const sessionId = getSessionId(req);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid request id' });
    }

    const checkSql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM workflow_requests WHERE demo_session_id = ? AND id = ? LIMIT 1'
      : 'SELECT * FROM workflow_requests WHERE id = ? LIMIT 1';
    const checkParams = pool.isDemoMode && sessionId ? [sessionId, requestId] : [requestId];

    const [rows] = await pool.execute(checkSql, checkParams);
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    if (pool.isDemoMode && sessionId) {
      await pool.execute('DELETE FROM approvals WHERE demo_session_id = ? AND request_id = ?', [sessionId, requestId]);
      await pool.execute('DELETE FROM request_history WHERE demo_session_id = ? AND request_id = ?', [sessionId, requestId]);
      await pool.execute('DELETE FROM workflow_requests WHERE demo_session_id = ? AND id = ?', [sessionId, requestId]);
    } else {
      await pool.execute('DELETE FROM approvals WHERE request_id = ?', [requestId]);
      await pool.execute('DELETE FROM request_history WHERE request_id = ?', [requestId]);
      await pool.execute('DELETE FROM workflow_requests WHERE id = ?', [requestId]);
    }

    res.json({ success: true, message: 'Request deleted successfully', id: requestId });
  } catch (err) {
    console.error('DELETE /requests/:id failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /approvals/:requestId
 */
app.get('/approvals/:requestId', optionalAuth, async (req, res) => {
  try {
    const { requestId } = req.params;
    const sessionId = getSessionId(req);

    const sql = pool.isDemoMode && sessionId
      ? `SELECT approver_role, step, status
         FROM approvals
         WHERE demo_session_id = ? AND request_id = ?
         ORDER BY step ASC`
      : `SELECT approver_role, step, status
         FROM approvals
         WHERE request_id = ?
         ORDER BY step ASC`;
    const params = pool.isDemoMode && sessionId ? [sessionId, requestId] : [requestId];

    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/manager/analytics
 */
app.get(['/api/manager/analytics', '/manager/analytics', '/api/analytics/dashboard'], async (req, res) => {
  try {
    const targetRole = req.query.role || 'Manager';
    const isFilteredByRole = targetRole && String(targetRole).toLowerCase() !== 'all';
    const roleParam = isFilteredByRole ? String(targetRole).toLowerCase().trim() : null;
    const sessionId = getSessionId(req);

    const demoFilter = pool.isDemoMode && sessionId ? 'demo_session_id = ? AND ' : '';
    const demoParams = pool.isDemoMode && sessionId ? [sessionId] : [];

    const [mgrPendingRes] = await pool.query(`SELECT COUNT(*) as count FROM workflow_requests WHERE ${demoFilter}LOWER(status) = 'pending manager approval'`, demoParams);
    const [overallPendingRes] = await pool.query(`SELECT COUNT(*) as count FROM workflow_requests WHERE ${demoFilter}(LOWER(status) LIKE 'pending%' OR LOWER(status) = 'waiting')`, demoParams);
    const [wfApprovedRes] = await pool.query(`SELECT COUNT(*) as count FROM workflow_requests WHERE ${demoFilter}LOWER(status) = 'approved'`, demoParams);
    const [wfRejectedRes] = await pool.query(`SELECT COUNT(*) as count FROM workflow_requests WHERE ${demoFilter}LOWER(status) = 'rejected'`, demoParams);
    const [totalRequestsRes] = await pool.query(`SELECT COUNT(*) as count FROM workflow_requests WHERE ${demoFilter}LOWER(status) != 'cancelled'`, demoParams);
    const [escalatedRes] = await pool.query(`SELECT COUNT(*) as count FROM workflow_requests WHERE ${demoFilter}LOWER(status) LIKE '%escalat%'`, demoParams);

    const managerPending = mgrPendingRes[0]?.count || 0;
    const overallPending = overallPendingRes[0]?.count || 0;
    const approvedCount = wfApprovedRes[0]?.count || 0;
    const rejectedCount = wfRejectedRes[0]?.count || 0;
    const totalRequests = totalRequestsRes[0]?.count || 0;
    const escalatedCount = escalatedRes[0]?.count || 0;

    let latestQuery;
    let latestParams = [];

    if (pool.isDemoMode && sessionId) {
      latestQuery = `
        SELECT ah.*,
               wr.amount as req_amount,
               wr.created_at as req_created_at,
               COALESCE(NULLIF(ah.department, ''), wr.department, 'Finance') as final_department
        FROM approval_history ah
        INNER JOIN (
          SELECT request_id, MAX(id) as max_id
          FROM approval_history
          WHERE demo_session_id = ?
          ${isFilteredByRole ? 'AND (LOWER(approval_stage) = LOWER(?) OR LOWER(manager_name) = LOWER(?))' : ''}
          GROUP BY request_id
        ) latest ON ah.id = latest.max_id
        LEFT JOIN workflow_requests wr ON ah.request_id = wr.id AND wr.demo_session_id = ?
        WHERE ah.demo_session_id = ?
      `;
      latestParams = isFilteredByRole ? [sessionId, roleParam, roleParam, sessionId, sessionId] : [sessionId, sessionId, sessionId];
    } else {
      latestQuery = `
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
      latestParams = isFilteredByRole ? [roleParam, roleParam] : [];
    }

    const [latestDecisions] = await pool.query(latestQuery, latestParams);

    let historyQuery;
    let historyParams = [];

    if (pool.isDemoMode && sessionId) {
      if (isFilteredByRole) {
        historyQuery = 'SELECT * FROM approval_history WHERE demo_session_id = ? AND (LOWER(approval_stage) = LOWER(?) OR LOWER(manager_name) = LOWER(?)) ORDER BY id DESC LIMIT 100';
        historyParams = [sessionId, roleParam, roleParam];
      } else {
        historyQuery = 'SELECT * FROM approval_history WHERE demo_session_id = ? ORDER BY id DESC LIMIT 100';
        historyParams = [sessionId];
      }
    } else {
      if (isFilteredByRole) {
        historyQuery = 'SELECT * FROM approval_history WHERE LOWER(approval_stage) = LOWER(?) OR LOWER(manager_name) = LOWER(?) ORDER BY id DESC LIMIT 100';
        historyParams = [roleParam, roleParam];
      } else {
        historyQuery = 'SELECT * FROM approval_history ORDER BY id DESC LIMIT 100';
        historyParams = [];
      }
    }

    const [historyRows] = await pool.query(historyQuery, historyParams);

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

    const approvedRequests = latestDecisions.filter((row) =>
      String(row.decision || row.action || '').toLowerCase().includes('approve')
    );

    const approvedAmounts = approvedRequests.map((r) => Number(r.req_amount || r.amount || 0));
    const highestApprovedAmount = approvedAmounts.length > 0 ? Math.max(...approvedAmounts) : 0;
    const lowestApprovedAmount = approvedAmounts.length > 0 ? Math.min(...approvedAmounts) : 0;
    const totalApprovedBudget = approvedAmounts.reduce((sum, val) => sum + val, 0);
    const avgApprovedAmount = approvedAmounts.length > 0 ? Math.round(totalApprovedBudget / approvedAmounts.length) : 0;

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

    const trendSql = pool.isDemoMode && sessionId
      ? `
        SELECT DATE_FORMAT(timestamp, '%Y-%m-%d') as date,
               SUM(CASE WHEN LOWER(decision) LIKE 'approve%' THEN 1 ELSE 0 END) as approved,
               SUM(CASE WHEN LOWER(decision) LIKE 'reject%' THEN 1 ELSE 0 END) as rejected
        FROM approval_history
        WHERE demo_session_id = ?
        ${isFilteredByRole ? 'AND (LOWER(approval_stage) = LOWER(?) OR LOWER(manager_name) = LOWER(?))' : ''}
        GROUP BY DATE_FORMAT(timestamp, '%Y-%m-%d')
        ORDER BY date ASC
      `
      : `
        SELECT DATE_FORMAT(timestamp, '%Y-%m-%d') as date,
               SUM(CASE WHEN LOWER(decision) LIKE 'approve%' THEN 1 ELSE 0 END) as approved,
               SUM(CASE WHEN LOWER(decision) LIKE 'reject%' THEN 1 ELSE 0 END) as rejected
        FROM approval_history
        ${isFilteredByRole ? 'WHERE LOWER(approval_stage) = LOWER(?) OR LOWER(manager_name) = LOWER(?)' : ''}
        GROUP BY DATE_FORMAT(timestamp, '%Y-%m-%d')
        ORDER BY date ASC
      `;
    const trendParams = pool.isDemoMode && sessionId
      ? (isFilteredByRole ? [sessionId, roleParam, roleParam] : [sessionId])
      : (isFilteredByRole ? [roleParam, roleParam] : []);

    const [trendRows] = await pool.query(trendSql, trendParams);

    const speedSql = pool.isDemoMode && sessionId
      ? `SELECT approval_stage as stage, ROUND(AVG(decision_time_seconds)/60, 1) as avg_mins FROM approval_history WHERE demo_session_id = ? AND decision_time_seconds > 0 GROUP BY approval_stage`
      : `SELECT approval_stage as stage, ROUND(AVG(decision_time_seconds)/60, 1) as avg_mins FROM approval_history WHERE decision_time_seconds > 0 GROUP BY approval_stage`;
    const speedParams = pool.isDemoMode && sessionId ? [sessionId] : [];
    const [speedRows] = await pool.query(speedSql, speedParams);

    const monthlySql = pool.isDemoMode && sessionId
      ? `SELECT DATE_FORMAT(created_at, '%b %Y') as month, COUNT(*) as count FROM workflow_requests WHERE demo_session_id = ? GROUP BY DATE_FORMAT(created_at, '%Y-%m'), DATE_FORMAT(created_at, '%b %Y') ORDER BY MIN(created_at) ASC`
      : `SELECT DATE_FORMAT(created_at, '%b %Y') as month, COUNT(*) as count FROM workflow_requests GROUP BY DATE_FORMAT(created_at, '%Y-%m'), DATE_FORMAT(created_at, '%b %Y') ORDER BY MIN(created_at) ASC`;
    const monthlyParams = pool.isDemoMode && sessionId ? [sessionId] : [];
    const [monthlyRows] = await pool.query(monthlySql, monthlyParams);

    const funnelSql = pool.isDemoMode && sessionId
      ? `SELECT COALESCE(current_role, 'Accounts') as stage, COUNT(*) as count FROM workflow_requests WHERE demo_session_id = ? GROUP BY stage`
      : `SELECT COALESCE(current_role, 'Accounts') as stage, COUNT(*) as count FROM workflow_requests GROUP BY stage`;
    const funnelParams = pool.isDemoMode && sessionId ? [sessionId] : [];
    const [funnelRows] = await pool.query(funnelSql, funnelParams);

    const pendingReqSql = pool.isDemoMode && sessionId
      ? `SELECT * FROM workflow_requests WHERE demo_session_id = ? AND LOWER(status) LIKE 'pending%' ORDER BY id DESC`
      : `SELECT * FROM workflow_requests WHERE LOWER(status) LIKE 'pending%' ORDER BY id DESC`;
    const pendingReqParams = pool.isDemoMode && sessionId ? [sessionId] : [];
    const [pendingRequests] = await pool.query(pendingReqSql, pendingReqParams);

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
      highestAmountApproved: highestApprovedAmount,
      lowestAmountApproved: lowestApprovedAmount,
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

/**
 * GET /approval-history & /api/approval-history
 */
app.get(['/approval-history', '/api/approval-history'], async (req, res) => {
  try {
    const queryRole = req.query.role || (req.user ? req.user.role : null);
    const sessionId = getSessionId(req);

    let query;
    let params = [];

    if (pool.isDemoMode && sessionId) {
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
          LEFT JOIN workflow_requests wr ON ah.request_id = wr.id AND wr.demo_session_id = ?
          WHERE ah.demo_session_id = ? AND (LOWER(ah.approval_stage) = LOWER(?) OR LOWER(ah.manager_name) = LOWER(?))
          ORDER BY ah.id DESC LIMIT 100
        `;
        params = [sessionId, sessionId, role, role];
      } else {
        query = `
          SELECT ah.*, 
                 wr.requester_name AS wr_requester_name, 
                 wr.requester_email AS wr_requester_email, 
                 wr.department AS wr_department, 
                 wr.type AS wr_type, 
                 wr.amount AS wr_amount,
                 wr.title AS wr_title
          FROM approval_history ah
          LEFT JOIN workflow_requests wr ON ah.request_id = wr.id AND wr.demo_session_id = ?
          WHERE ah.demo_session_id = ?
          ORDER BY ah.id DESC LIMIT 100
        `;
        params = [sessionId, sessionId];
      }
    } else {
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
      } else {
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
          ORDER BY ah.id DESC LIMIT 100
        `;
        params = [];
      }
    }

    const [rows] = await pool.query(query, params);

    const allReqsSql = pool.isDemoMode && sessionId
      ? 'SELECT id, requester_email, requester_name FROM workflow_requests WHERE demo_session_id = ? ORDER BY id ASC'
      : 'SELECT id, requester_email, requester_name FROM workflow_requests ORDER BY id ASC';
    const allReqsParams = pool.isDemoMode && sessionId ? [sessionId] : [];
    const [allReqs] = await pool.query(allReqsSql, allReqsParams);

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

/**
 * POST /history
 */
app.post('/history', async (req, res) => {
  try {
    const { request_id, action, performed_by } = req.body || {};
    const normalizedRequestId = Number(request_id);
    const sessionId = getSessionId(req);

    if (!Number.isInteger(normalizedRequestId) || normalizedRequestId <= 0) {
      return res.status(400).json({ error: 'Invalid request_id' });
    }

    const checkSql = pool.isDemoMode && sessionId
      ? 'SELECT id FROM workflow_requests WHERE demo_session_id = ? AND id = ? LIMIT 1'
      : 'SELECT id FROM workflow_requests WHERE id = ? LIMIT 1';
    const checkParams = pool.isDemoMode && sessionId ? [sessionId, normalizedRequestId] : [normalizedRequestId];

    const [requestRows] = await pool.execute(checkSql, checkParams);
    if (!Array.isArray(requestRows) || requestRows.length === 0) {
      return res.status(400).json({ error: 'request_id must be a valid workflow_requests.id' });
    }

    const performer = performed_by || req.user?.name || req.user?.email || 'User';

    if (pool.isDemoMode && sessionId) {
      await pool.execute(
        `INSERT INTO request_history (demo_session_id, request_id, action, performed_by)
         VALUES (?, ?, ?, ?)`,
        [sessionId, normalizedRequestId, action || 'Updated history', performer]
      );
    } else {
      await pool.execute(
        `INSERT INTO request_history (request_id, action, performed_by)
         VALUES (?, ?, ?)`,
        [normalizedRequestId, action || 'Updated history', performer]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('History insert error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /history/:requestId
 */
app.get('/history/:requestId', async (req, res) => {
  try {
    const requestId = Number(req.params.requestId);
    const sessionId = getSessionId(req);

    const sql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM request_history WHERE demo_session_id = ? AND request_id = ? ORDER BY id ASC'
      : 'SELECT * FROM request_history WHERE request_id = ? ORDER BY id ASC';
    const params = pool.isDemoMode && sessionId ? [sessionId, requestId] : [requestId];

    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Direct login endpoint (mirrors /api/auth/login)
 */
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const sessionId = getSessionId(req);

    const sql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM users WHERE demo_session_id = ? AND email = ? AND password = ?'
      : 'SELECT * FROM users WHERE email = ? AND password = ?';
    const params = pool.isDemoMode && sessionId ? [sessionId, email, password] : [email, password];

    const [rows] = await pool.execute(sql, params);

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
      demo_session_id: pool.isDemoMode ? sessionId : undefined,
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

    const sql = pool.isDemoMode && sessionId
      ? 'UPDATE users SET recovery_email = ? WHERE demo_session_id = ? AND id = ?'
      : 'UPDATE users SET recovery_email = ? WHERE id = ?';
    const params = pool.isDemoMode && sessionId ? [email, sessionId, userId] : [email, userId];

    const [result] = await pool.execute(sql, params);

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
  try {
    await pool.query('SELECT 1');
    res.json({ message: 'DB Working', mode: pool.isDemoMode ? 'DEMO' : 'PRODUCTION', database: pool.databaseName });
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

// Start Server with auto port recovery
initializeMysqlStorage().finally(() => {
  const PORT = Number(process.env.PORT || 4000);

  function listenOnPort(port) {
    const server = app.listen(port, () => {
      console.log(`ZyroFlow Server running on port ${port} (Mode: ${pool.isDemoMode ? 'DEMO' : 'PRODUCTION'})`);
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
            console.log(`ZyroFlow Server successfully started on port ${port}`);
          });
        }, 1000);
      } else {
        console.error('Server error:', err);
      }
    });
  }

  listenOnPort(PORT);
});
