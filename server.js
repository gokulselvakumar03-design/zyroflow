const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mysql = require('mysql2');
const authRoutes = require('./routes/authRoutes');
const rulesRoutes = require('./routes/rulesRoutes');
const requestsRoutes = require('./routes/requestsRoutes');
const approvalsRoutes = require('./routes/approvalsRoutes');
const trackRoutes = require('./routes/trackRoutes');
const profileRoutes = require('./routes/profileRoutes');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

let db;
let dbPool;

async function initializeMysqlStorage() {
  try {
    console.log('Connecting to MySQL...');

    const host = process.env.MYSQL_HOST || 'localhost';
    const user = process.env.MYSQL_USER || 'root';
    const database = 'zyroflow';
    const configuredPassword = process.env.MYSQL_PASSWORD;
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

    await db.promise().query('CREATE DATABASE IF NOT EXISTS zyroflow');
    await db.promise().query('USE zyroflow');
    try {
      console.log('Initializing DB...');
      await db.promise().execute('SET FOREIGN_KEY_CHECKS = 0');
      await db.promise().execute('DROP TABLE IF EXISTS approvals');
      await db.promise().execute('DROP TABLE IF EXISTS workflow_requests');
      await db.promise().execute('SET FOREIGN_KEY_CHECKS = 1');
      await db.promise().execute(`
        CREATE TABLE workflow_requests (
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
          workflow TEXT,
          payload JSON NULL,
          current_level INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      await db.promise().execute(`
        CREATE TABLE IF NOT EXISTS approvals (
          id INT AUTO_INCREMENT PRIMARY KEY,
          request_id INT,
          approver_role VARCHAR(50),
          step INT,
          status VARCHAR(50),
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (request_id) REFERENCES workflow_requests(id)
        )
      `);
      console.log('Table ready');
    } catch (err) {
      await db.promise().execute('SET FOREIGN_KEY_CHECKS = 1');
      console.error('DB Init Error:', err.message);
    }
    await db.promise().query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(100) UNIQUE,
        password VARCHAR(100),
        role VARCHAR(50),
        phone VARCHAR(20),
        department VARCHAR(100),
        profile_image VARCHAR(255)
      )
    `);
    // ensure new profile columns exist for older databases
    try {
      await db.promise().query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20)");
      await db.promise().query("ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100)");
      await db.promise().query("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image VARCHAR(255)");
    } catch (e) {
      // Some MySQL versions do not support IF NOT EXISTS for ADD COLUMN - attempt guarded add
      try { await db.promise().query("ALTER TABLE users ADD COLUMN phone VARCHAR(20)"); } catch (e2) {}
      try { await db.promise().query("ALTER TABLE users ADD COLUMN department VARCHAR(100)"); } catch (e2) {}
      try { await db.promise().query("ALTER TABLE users ADD COLUMN profile_image VARCHAR(255)"); } catch (e2) {}
    }

    await db.promise().query(`
      INSERT IGNORE INTO users (name, email, password, role, phone, department, profile_image) VALUES
      ('Admin', 'admin@zyroflow.com', 'admin123', 'admin', '', '', ''),
      ('Accounts', 'accounts@zyroflow.com', 'acc123', 'accounts', '', '', ''),
      ('Manager', 'manager@zyroflow.com', 'man123', 'manager', '', '', ''),
      ('CFO', 'cfo@zyroflow.com', 'cfo123', 'cfo', '', '', ''),
      ('MD', 'md@zyroflow.com', 'md123', 'md', '', '', ''),
      ('Employee One', 'employee1@zyroflow.com', 'emp123', 'employee', '', '', '')
    `);
    await db.promise().query(`
      CREATE TABLE IF NOT EXISTS request_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        request_id BIGINT,
        action VARCHAR(100),
        performed_by VARCHAR(100),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.promise().query('ALTER TABLE request_history MODIFY request_id BIGINT');

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
  return Array.isArray(workflow) ? workflow : [];
}

function mapRequestRow(row) {
  const workflow = getWorkflowList(row);
  const payload = parseJsonValue(row.payload, {});
  const createdAt = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : createdAt;
  const currentLevel = Number(row.current_level ?? 0);
  const currentRole = row.current_role || workflow[Math.min(currentLevel, Math.max(workflow.length - 1, 0))] || '';
  const currentApprover = row.current_approver || currentRole || '';

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
    payload,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
  };
}

function normalizeRequestInput(body = {}) {
  const workflow = parseJsonValue(body.workflow, []);
  const workflowArray = Array.isArray(workflow) ? workflow : [];
  const currentLevel = Number(body.current_level ?? body.currentLevel ?? 0);
  const currentRole = body.current_role || body.currentRole || workflowArray[Math.min(currentLevel, Math.max(workflowArray.length - 1, 0))] || '';
  const payload = parseJsonValue(body.payload, null) || body;

  return {
    title: body.title || body.request_type || body.type || payload.title || payload.request_type || payload.type || null,
    type: body.type || body.request_type || body.title || payload.type || payload.request_type || payload.title || null,
    description: body.description || payload.description || null,
    amount: Number(body.amount ?? payload.amount ?? 0),
    department: body.department || payload.department || null,
    priority: body.priority || payload.priority || null,
    status: String(body.status || payload.status || 'pending').toLowerCase(),
    requester_name: body.requester_name || body.requesterName || payload.requester_name || payload.requesterName || payload.requester || null,
    requester_email: body.requester_email || body.requesterEmail || payload.requester_email || payload.requesterEmail || payload.email || null,
    current_role: currentRole || null,
    current_approver: body.current_approver || body.currentApprover || currentRole || null,
    workflow: JSON.stringify(workflowArray),
    payload: JSON.stringify(payload),
    current_level: currentLevel,
  };
}

app.use('/api/auth', authRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api', approvalsRoutes); // /api/approve, /api/reject, /api/pending-approvals
app.use('/api', trackRoutes); // /api/track/:requestId
app.use('/api', profileRoutes); // /api/profile, /api/change-password

app.get('/requests', async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ message: 'Database unavailable' });
  }

  try {
    const [rows] = await dbPool.query('SELECT * FROM workflow_requests ORDER BY id DESC');
    const data = rows.map(mapRequestRow);

    res.json(data);
  } catch (error) {
    console.error('GET /requests failed:', error.message);
    res.status(500).json({ message: 'Failed to fetch requests' });
  }
});

app.get('/requests/:id', async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ message: 'Database unavailable' });
  }

  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ message: 'Invalid request id' });
    }

    const [rows] = await dbPool.execute('SELECT * FROM workflow_requests WHERE id = ? LIMIT 1', [requestId]);
    if (!rows.length) {
      return res.status(404).json({ message: 'Request not found' });
    }

    res.json(mapRequestRow(rows[0]));
  } catch (error) {
    console.error('GET /requests/:id failed:', error.message);
    res.status(500).json({ message: 'Failed to fetch request' });
  }
});

app.post('/requests', async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ success: false, error: 'Database unavailable' });
  }

  try {
    const requestData = normalizeRequestInput(req.body || {});

    const [result] = await dbPool.execute(
      `INSERT INTO workflow_requests
       (title, type, description, amount, department, priority, status, requester_name, requester_email, current_role, current_approver, workflow, payload, current_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        requestData.title,
        requestData.type,
        requestData.description,
        requestData.amount,
        requestData.department,
        requestData.priority,
        requestData.status,
        requestData.requester_name,
        requestData.requester_email,
        requestData.current_role,
        requestData.current_approver,
        requestData.workflow,
        requestData.payload,
        requestData.current_level,
      ]
    );

    const requestId = result.insertId;
    const workflowArray = getWorkflowList({ workflow: requestData.workflow });

    for (let i = 0; i < workflowArray.length; i += 1) {
      await dbPool.execute(
        `INSERT INTO approvals (request_id, approver_role, step, status)
         VALUES (?, ?, ?, ?)`,
        [
          requestId,
          workflowArray[i],
          i,
          i === 0 ? 'pending' : 'waiting'
        ]
      );
    }

    const [createdRows] = await dbPool.execute('SELECT * FROM workflow_requests WHERE id = ? LIMIT 1', [requestId]);
    res.json({ success: true, id: requestId, request: mapRequestRow(createdRows[0]) });
  } catch (err) {
    console.error('INSERT ERROR:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/requests/:id', async (req, res) => {
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
    if (String(existing.status || '').toLowerCase() !== 'pending') {
      return res.status(409).json({ success: false, error: 'Only pending requests can be edited' });
    }

    const updateData = normalizeRequestInput(req.body || {});
    await dbPool.execute(
      `UPDATE workflow_requests
       SET title = ?, type = ?, description = ?, amount = ?, department = ?, priority = ?, status = ?, requester_name = ?, requester_email = ?, current_role = ?, current_approver = ?, workflow = ?, payload = ?, current_level = ?
       WHERE id = ?`,
      [
        updateData.title,
        updateData.type,
        updateData.description,
        updateData.amount,
        updateData.department,
        updateData.priority,
        existing.status,
        updateData.requester_name || existing.requester,
        updateData.requester_email || existing.requesterEmail,
        updateData.current_role || existing.currentRole,
        updateData.current_approver || existing.currentApprover,
        updateData.workflow,
        updateData.payload,
        updateData.current_level,
        requestId,
      ]
    );

    const [updatedRows] = await dbPool.execute('SELECT * FROM workflow_requests WHERE id = ? LIMIT 1', [requestId]);
    res.json({ success: true, request: mapRequestRow(updatedRows[0]) });
  } catch (err) {
    console.error('PUT /requests/:id failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/requests/:id/status', async (req, res) => {
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
    if (newStatus === 'cancelled' && String(existing.status || '').toLowerCase() !== 'pending') {
      return res.status(409).json({ success: false, error: 'This request can no longer be cancelled.' });
    }

    await dbPool.execute(
      'UPDATE workflow_requests SET status = ? WHERE id = ?',
      [newStatus, requestId]
    );

    const [updatedRows] = await dbPool.execute('SELECT * FROM workflow_requests WHERE id = ? LIMIT 1', [requestId]);
    res.json({ success: true, request: mapRequestRow(updatedRows[0]) });
  } catch (err) {
    console.error('PATCH /requests/:id/status failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/approvals/:requestId', async (req, res) => {
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

app.post('/approve', async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ error: 'Database unavailable' });
  }

  try {
    const { requestId, role, action } = req.body || {};

    await dbPool.execute(
      `UPDATE approvals
       SET status = ?
       WHERE request_id = ? AND approver_role = ?`,
      [action, requestId, role]
    );

    if (action === 'approved') {
      await dbPool.execute(
        `UPDATE approvals
         SET status = 'pending'
         WHERE request_id = ? AND step = (
           SELECT step + 1 FROM (
             SELECT step FROM approvals
             WHERE request_id = ? AND approver_role = ?
           ) as temp
         )`,
        [requestId, requestId, role]
      );

      const [pendingRows] = await dbPool.execute(
        `SELECT step FROM approvals WHERE request_id = ? AND status = 'pending' ORDER BY step ASC LIMIT 1`,
        [requestId]
      );

      if (pendingRows.length === 0) {
        await dbPool.execute('UPDATE workflow_requests SET status = ?, current_level = current_level WHERE id = ?', ['approved', requestId]);
      } else {
        await dbPool.execute('UPDATE workflow_requests SET status = ?, current_level = ? WHERE id = ?', ['pending', Number(pendingRows[0].step || 0), requestId]);
      }
    }

    if (action === 'rejected') {
      await dbPool.execute('UPDATE workflow_requests SET status = ? WHERE id = ?', ['rejected', requestId]);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    await dbPool.execute(
      `INSERT INTO request_history (request_id, action, performed_by)
       VALUES (?, ?, ?)`,
      [Number.isFinite(normalizedRequestId) ? normalizedRequestId : null, action || null, performed_by || null]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('History insert error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ success: false, error: err.message });
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
  res.json({ message: 'Multi-Level Approval Workflow API is running' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

initializeMysqlStorage().finally(() => {
  const PORT = Number(process.env.PORT || 5000);
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  const LOGIN_PORT = 4000;
  if (PORT !== LOGIN_PORT) {
    app.listen(LOGIN_PORT, () => {
      console.log(`Login/API mirror running on port ${LOGIN_PORT}`);
    });
  }
});
