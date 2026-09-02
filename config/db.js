const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
  password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.MYSQL_DB || process.env.DB_NAME || 'zyroflow',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Temporary Debug
(async () => {
  try {
    const conn = await pool.getConnection();

    const [db] = await conn.query("SELECT DATABASE() AS db");
    console.log("Connected Database:", db[0].db);

    const [count] = await conn.query("SELECT COUNT(*) AS total FROM workflow_requests");
    console.log("Requests Table Count:", count[0].total);

    conn.release();
  } catch (err) {
    console.error("Database Debug Error:", err);
  }
})();

module.exports = pool;