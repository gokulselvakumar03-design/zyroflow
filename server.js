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
    await db.promise().query(`
      CREATE TABLE IF NOT EXISTS workflow_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255),
        type VARCHAR(100),
        amount INT,
        status VARCHAR(50),
        currentRole VARCHAR(50),
        createdAt BIGINT,
        deadline BIGINT,
        escalated BOOLEAN DEFAULT FALSE,
        fileName VARCHAR(255),
        payload JSON NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

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
      if (row.payload) {
        try {
          return typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        } catch (e) {
          return {
            id: row.id,
            title: row.title,
            type: row.type,
            amount: Number(row.amount || 0),
            status: row.status,
            currentRole: row.currentRole,
            createdAt: row.createdAt,
            deadline: row.deadline,
            escalated: Boolean(row.escalated),
            fileName: row.fileName,
          };
        }
      }

      return {
        id: row.id,
        title: row.title,
        type: row.type,
        amount: Number(row.amount || 0),
        status: row.status,
        currentRole: row.currentRole,
        createdAt: row.createdAt,
        deadline: row.deadline,
        escalated: Boolean(row.escalated),
        fileName: row.fileName,
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
    return res.status(500).json({ message: 'Database unavailable' });
  }

  try {
    const request = req.body || {};
    const {
      id,
      title,
      type,
      amount,
      status,
      currentRole,
      createdAt,
      deadline,
      escalated,
      fileName,
    } = request;

    await dbPool.query(
      `INSERT INTO workflow_requests
       (id, title, type, amount, status, currentRole, createdAt, deadline, escalated, fileName, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         type = VALUES(type),
         amount = VALUES(amount),
         status = VALUES(status),
         currentRole = VALUES(currentRole),
         createdAt = VALUES(createdAt),
         deadline = VALUES(deadline),
         escalated = VALUES(escalated),
         fileName = VALUES(fileName),
         payload = VALUES(payload)`,
      [
        id ? Number(id) : null,
        title || null,
        type || null,
        Number(amount || 0),
        status || null,
        currentRole || null,
        createdAt ? Number(createdAt) : null,
        deadline ? Number(deadline) : null,
        Boolean(escalated),
        fileName || null,
        JSON.stringify(request),
      ]
    );

    res.status(201).json({ success: true });
  } catch (error) {
    console.error('POST /requests failed:', error.message);
    res.status(500).json({ message: 'Failed to save request' });
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
});
