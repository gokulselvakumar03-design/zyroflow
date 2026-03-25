const pool = require('../config/db');

exports.getPendingApprovals = async (req, res, next) => {
  try {
    const role = req.user.role;
    const [rows] = await pool.execute(
      `SELECT a.*, r.employee_id, r.request_type, r.amount, r.description, r.status as request_status
       FROM approvals a
       JOIN requests r ON a.request_id = r.id
       WHERE a.approver_role = ? AND a.status = 'pending'`,
      [role]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

async function updateRequestStatus(conn, requestId) {
  const [pendingRows] = await conn.execute(
    "SELECT status FROM approvals WHERE request_id = ? AND status IN ('pending','waiting')",
    [requestId]
  );

  if (pendingRows.length === 0) {
    await conn.execute('UPDATE requests SET status = ? WHERE id = ?', ['approved', requestId]);
  } else {
    // If any pending exists, keep in_progress
    await conn.execute('UPDATE requests SET status = ? WHERE id = ?', ['in_progress', requestId]);
  }
}

exports.approve = async (req, res, next) => {
  let conn;
  try {
    const role = req.user.role;
    const { request_id } = req.body;
    if (!request_id) return res.status(400).json({ message: 'request_id required' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [requestRows] = await conn.execute('SELECT status FROM requests WHERE id = ? FOR UPDATE', [request_id]);
    const request = requestRows[0];
    if (!request || request.status === 'rejected' || request.status === 'approved') {
      await conn.rollback();
      return res.status(400).json({ message: 'Request cannot be approved' });
    }

    const [currentRows] = await conn.execute(
      'SELECT * FROM approvals WHERE request_id = ? AND approver_role = ? AND status = ?',
      [request_id, role, 'pending']
    );
    const current = currentRows[0];
    if (!current) {
      await conn.rollback();
      return res.status(403).json({ message: 'No matching pending approval for you' });
    }

    await conn.execute('UPDATE approvals SET status = ? WHERE id = ?', ['approved', current.id]);

    const nextStep = current.step + 1;
    const [nextRows] = await conn.execute(
      'SELECT * FROM approvals WHERE request_id = ? AND step = ?',
      [request_id, nextStep]
    );

    if (nextRows.length > 0) {
      await conn.execute('UPDATE approvals SET status = ? WHERE id = ?', ['pending', nextRows[0].id]);
    }

    await updateRequestStatus(conn, request_id);

    await conn.commit();
    res.json({ message: 'Approved' });
  } catch (err) {
    if (conn) await conn.rollback();
    next(err);
  } finally {
    if (conn) conn.release();
  }
};

exports.reject = async (req, res, next) => {
  let conn;
  try {
    const role = req.user.role;
    const { request_id } = req.body;
    if (!request_id) return res.status(400).json({ message: 'request_id required' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [requestRows] = await conn.execute('SELECT status FROM requests WHERE id = ? FOR UPDATE', [request_id]);
    const request = requestRows[0];
    if (!request || request.status === 'rejected' || request.status === 'approved') {
      await conn.rollback();
      return res.status(400).json({ message: 'Request cannot be rejected' });
    }

    const [currentRows] = await conn.execute(
      'SELECT * FROM approvals WHERE request_id = ? AND approver_role = ? AND status = ?',
      [request_id, role, 'pending']
    );
    const current = currentRows[0];
    if (!current) {
      await conn.rollback();
      return res.status(403).json({ message: 'No matching pending approval for you' });
    }

    await conn.execute('UPDATE approvals SET status = ? WHERE id = ?', ['rejected', current.id]);
    await conn.execute('UPDATE requests SET status = ? WHERE id = ?', ['rejected', request_id]);

    await conn.commit();
    res.json({ message: 'Rejected' });
  } catch (err) {
    if (conn) await conn.rollback();
    next(err);
  } finally {
    if (conn) conn.release();
  }
};
