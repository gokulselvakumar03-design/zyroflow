const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mysql = require('mysql2');
const authRoutes = require('./routes/authRoutes');
const rulesRoutes = require('./routes/rulesRoutes');
const requestsRoutes = require('./routes/requestsRoutes');
const approvalsRoutes = require('./routes/approvalsRoutes');
const trackRoutes = require('./routes/trackRoutes');

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
          status VARCHAR(50),
          workflow TEXT,
          current_level INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        role VARCHAR(50)
      )
    `);
    await db.promise().query(`
      INSERT IGNORE INTO users (name, email, password, role) VALUES
      ('Admin', 'admin@zyroflow.com', 'admin123', 'admin'),
      ('Accounts', 'accounts@zyroflow.com', 'acc123', 'accounts'),
      ('Manager', 'manager@zyroflow.com', 'man123', 'manager'),
      ('CFO', 'cfo@zyroflow.com', 'cfo123', 'cfo'),
      ('MD', 'md@zyroflow.com', 'md123', 'md'),
      ('Employee One', 'employee1@zyroflow.com', 'emp123', 'employee')
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

app.use('/api/auth', authRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api', approvalsRoutes); // /api/approve, /api/reject, /api/pending-approvals
app.use('/api', trackRoutes); // /api/track/:requestId

app.get('/requests', async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ message: 'Database unavailable' });
  }

  try {
    const [rows] = await dbPool.query('SELECT * FROM workflow_requests ORDER BY id DESC');
    const data = rows.map((row) => {
      let workflow = [];
      if (typeof row.workflow === 'string') {
        try {
          workflow = JSON.parse(row.workflow);
        } catch (e) {
          workflow = [];
        }
      } else if (Array.isArray(row.workflow)) {
        workflow = row.workflow;
      }

      return {
        id: row.id,
        title: row.title,
        type: row.type,
        description: row.description,
        amount: Number(row.amount || 0),
        status: row.status,
        workflow,
        current_level: Number(row.current_level || 0),
        createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      };
    });

    res.json(data);
  } catch (error) {
    console.error('GET /requests failed:', error.message);
    res.status(500).json({ message: 'Failed to fetch requests' });
  }
});

app.post('/requests', async (req, res) => {
  if (!dbPool) {
    return res.status(500).json({ success: false, error: 'Database unavailable' });
  }

  try {
    const {
      title,
      type,
      description,
      amount,
      status,
      workflow,
      current_level
    } = req.body || {};

    const [result] = await dbPool.execute(
      `INSERT INTO workflow_requests
       (title, type, description, amount, status, workflow, current_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        title || null,
        type || null,
        description || null,
        Number(amount || 0),
        status || 'pending',
        workflow || '[]',
        Number(current_level || 0)
      ]
    );

    const requestId = result.insertId;
    let workflowArray = [];
    try {
      workflowArray = JSON.parse(workflow || '[]');
    } catch (e) {
      workflowArray = [];
    }

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

    res.json({ success: true, id: requestId });
  } catch (err) {
    console.error('INSERT ERROR:', err.message);
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
