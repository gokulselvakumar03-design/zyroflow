const mysql = require('mysql2/promise');

async function check() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: 'root123',
      database: 'approval_workflow'
    });
    const [rows] = await conn.execute('SELECT * FROM workflow_requests ORDER BY id DESC LIMIT 10');
    console.log('--- RECENT WORKFLOW REQUESTS ---');
    rows.forEach(r => {
      let p = {};
      try { p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload; } catch(e){}
      console.log('ID:', r.id);
      console.log('Title/Type:', r.title || r.type);
      console.log('File Name:', r.fileName || r.file_name);
      console.log('Payload attached_file_name:', p.attached_file_name);
      console.log('Payload attached_file_url length:', p.attached_file_url ? p.attached_file_url.length : 0);
      console.log('Payload attached_file_url preview:', p.attached_file_url ? p.attached_file_url.substring(0, 70) : null);
      console.log('----------------------------------------------------');
    });
    await conn.end();
  } catch (err) {
    console.error('Check DB Error:', err.message);
  }
}

check();
