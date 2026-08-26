const fs = require('fs');
const mysql = require('mysql2/promise');

async function fix() {
  try {
    const b64Data = fs.readFileSync('frontend/Receipt_INV-1675.b64', 'utf8').trim();
    console.log('Read b64 photo data length:', b64Data.length);

    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: 'root123',
      database: 'approval_workflow'
    });

    const [rows] = await conn.execute('SELECT id, payload FROM workflow_requests');
    console.log(`Found ${rows.length} request(s) in DB.`);

    for (const r of rows) {
      let p = {};
      try { p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload; } catch(e){}
      
      p.attached_file_name = 'Receipt_INV-1675.jpg';
      p.attached_file_type = 'image/jpeg';
      p.attached_file_url = b64Data;
      p.receipt_file = b64Data;
      p.receipt_url = b64Data;
      p.receipt_photo = b64Data;
      p.fileName = 'Receipt_INV-1675.jpg';
      p.file_name = 'Receipt_INV-1675.jpg';
      p.attachments = [
        {
          name: 'Receipt_INV-1675.jpg',
          type: 'image/jpeg',
          url: b64Data
        }
      ];

      await conn.execute(
        'UPDATE workflow_requests SET payload = ? WHERE id = ?',
        [JSON.stringify(p), r.id]
      );
      console.log(`Updated request ID ${r.id} in DB to use original JPG receipt photo!`);
    }

    await conn.end();
    console.log('Database updated successfully!');
  } catch (err) {
    console.error('Fix DB Error:', err.message);
  }
}

fix();
