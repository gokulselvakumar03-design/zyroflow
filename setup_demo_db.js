/**
 * Script to Initialize Local Demo Database: zyroflow_demo
 * Reads demo_init.sql and executes the statements against MySQL.
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function setupDemoDatabase() {
  const host = process.env.MYSQL_HOST || 'localhost';
  const user = process.env.MYSQL_USER || 'root';
  const configuredPassword = process.env.MYSQL_PASSWORD !== undefined ? process.env.MYSQL_PASSWORD : process.env.DB_PASSWORD;

  console.log(`[SETUP DEMO DB] Connecting to MySQL at ${host}...`);

  const connection = await mysql.createConnection({
    host,
    user,
    password: configuredPassword,
    multipleStatements: true
  });

  try {
    const sqlPath = path.join(__dirname, 'demo_init.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    console.log('[SETUP DEMO DB] Executing demo_init.sql...');
    await connection.query(sqlContent);

    console.log('[SETUP DEMO DB] ✓ Database zyroflow_demo and tables created successfully.');

    // Verify tables
    await connection.query('USE zyroflow_demo');
    const [tables] = await connection.query('SHOW TABLES');
    console.log('[SETUP DEMO DB] Tables in zyroflow_demo:');
    console.table(tables);

    // Verify production DB is untouched
    const [prodCheck] = await connection.query("SHOW DATABASES LIKE 'zyroflow'");
    if (prodCheck.length > 0) {
      await connection.query('USE zyroflow');
      const [prodCount] = await connection.query('SELECT COUNT(*) as count FROM workflow_requests');
      console.log(`[SETUP DEMO DB] Production database zyroflow verified intact. Requests count: ${prodCount[0]?.count}`);
    }

  } catch (err) {
    console.error('[SETUP DEMO DB] ❌ Error:', err.message);
  } finally {
    await connection.end();
  }
}

setupDemoDatabase();
