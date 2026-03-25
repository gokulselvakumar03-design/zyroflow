const pool = require('../config/db');

exports.createRequest = async (req, res, next) => {
  let conn;
  try {
    const employee_id = req.user.id;
    const { request_type, amount, description } = req.body;

    if (!request_type || amount == null || !description) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [ruleRows] = await conn.execute(
      'SELECT * FROM rules WHERE request_type = ? AND ? BETWEEN min_amount AND max_amount ORDER BY min_amount DESC LIMIT 1',
      [request_type, amount]
    );
    const rule = ruleRows[0];
    if (!rule) {
      await conn.rollback();
      return res.status(400).json({ message: 'No matching approval rule for this request' });
    }

    const [reqResult] = await conn.execute(
      'INSERT INTO requests (employee_id, request_type, amount, description, status) VALUES (?, ?, ?, ?, ?)',
      [employee_id, request_type, amount, description, 'pending']
    );

    const requestId = reqResult.insertId;
    const approverChain = String(rule.approvers).split(',').map((s) => s.trim()).filter(Boolean);

    if (approverChain.length === 0) {
      await conn.rollback();
      return res.status(500).json({ message: 'Rule has no approvers chain' });
    }

    const approvalInserts = approverChain.map((role, idx) => [
      requestId,
      role,
      idx + 1,
      idx === 0 ? 'pending' : 'waiting',
    ]);

    await conn.query(
      'INSERT INTO approvals (request_id, approver_role, step, status) VALUES ?',
      [approvalInserts]
    );

    await conn.commit();
    res.status(201).json({ message: 'Request created and workflow started', request_id: requestId });
  } catch (err) {
    if (conn) await conn.rollback();
    next(err);
  } finally {
    if (conn) conn.release();
  }
};
