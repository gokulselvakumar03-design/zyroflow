const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const isDemoMode = String(process.env.DEMO_MODE || '').toLowerCase() === 'true' ||
                   String(process.env.APP_ENV || '').toLowerCase() === 'demo';

const host = process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost';
const port = Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306);
const user = process.env.MYSQL_USER || process.env.DB_USER || 'root';
const password = process.env.MYSQL_PASSWORD !== undefined ? process.env.MYSQL_PASSWORD : process.env.DB_PASSWORD;

// Database name configuration
let database;
if (isDemoMode) {
  database = process.env.MYSQL_DEMO_DB || (process.env.MYSQL_DB && process.env.MYSQL_DB !== 'approval_workflow' ? process.env.MYSQL_DB : 'zyroflow_demo');
} else {
  database = process.env.MYSQL_DB || process.env.DB_NAME || 'zyroflow';
}

// STRICT SAFETY INTERLOCK:
// Prevent Demo Mode from ever connecting to the production database 'zyroflow'
if (isDemoMode && database.toLowerCase() === 'zyroflow') {
  const errorMsg = 'FATAL SECURITY INTERLOCK: DEMO_MODE is true but configured database is production "zyroflow"! Aborting startup to protect production data.';
  console.error(errorMsg);
  throw new Error(errorMsg);
}

const pool = mysql.createPool({
  host,
  port,
  user,
  password,
  database,
  ssl: process.env.MYSQL_SSL === 'true'
    ? { rejectUnauthorized: false }
    : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

pool.isDemoMode = isDemoMode;
pool.databaseName = database;

// Validate Connection on startup
(async () => {
  try {
    const conn = await pool.getConnection();
    const [db] = await conn.query("SELECT DATABASE() AS db");
    console.log(`[DB CONFIG] Mode: ${isDemoMode ? 'DEMO' : 'PRODUCTION'} | Connected Database: ${db[0]?.db || database}`);
    conn.release();
  } catch (err) {
    console.error("[DB CONFIG] Database Connection Error:", err.message);
  }
})();

module.exports = pool;