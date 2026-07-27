const pool = require('../config/db');

exports.getPendingApprovals = async (req, res, next) => {
  try {
    const role = req.user ? req.user.role : '';
    const [rows] = await pool.execute(
      `SELECT a.*, r.requester_name as employee_id, r.type as request_type, r.amount, r.description, r.status as request_status
       FROM approvals a
       JOIN workflow_requests r ON a.request_id = r.id
       WHERE LOWER(a.approver_role) = LOWER(?) AND a.status = 'pending'`,
      [role]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

async function updateRequestStatus(conn, requestId) {
  const [pendingRows] = await conn.execute(
    "SELECT status, step, approver_role FROM approvals WHERE request_id = ? AND status IN ('pending','waiting') ORDER BY step ASC",
    [requestId]
  );

  if (pendingRows.length === 0) {
    await conn.execute('UPDATE workflow_requests SET status = ? WHERE id = ?', ['approved', requestId]);
  } else {
    const active = pendingRows.find(r => r.status === 'pending') || pendingRows[0];
    await conn.execute(
      'UPDATE workflow_requests SET status = ?, current_role = ?, current_approver = ?, current_level = ? WHERE id = ?',
      ['pending', active.approver_role, active.approver_role, Number(active.step || 0), requestId]
    );
  }
}

exports.approve = async (req, res, next) => {
  let conn;
  try {
    const role = req.user ? req.user.role : (req.body?.role || 'Accounts');
    const { request_id, requestId, comments } = req.body || {};
    const id = Number(request_id || requestId || req.params.id);
    if (!id || !Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Valid request_id required' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [requestRows] = await conn.execute('SELECT status FROM workflow_requests WHERE id = ? FOR UPDATE', [id]);
    const request = requestRows[0];
    if (!request || request.status === 'rejected' || request.status === 'approved') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Request cannot be approved' });
    }

    const [currentRows] = await conn.execute(
      'SELECT * FROM approvals WHERE request_id = ? AND LOWER(approver_role) = LOWER(?) AND status = ? ORDER BY step ASC LIMIT 1',
      [id, role, 'pending']
    );
    let current = currentRows[0];
    if (!current) {
      const [anyRows] = await conn.execute(
        'SELECT * FROM approvals WHERE request_id = ? AND LOWER(approver_role) = LOWER(?) ORDER BY step ASC LIMIT 1',
        [id, role]
      );
      current = anyRows[0];
    }

    if (!current) {
      await conn.rollback();
      return res.status(403).json({ success: false, message: 'No matching pending approval for you' });
    }

    await conn.execute('UPDATE approvals SET status = ? WHERE id = ?', ['approved', current.id]);

    const nextStep = current.step + 1;
    const [nextRows] = await conn.execute(
      'SELECT * FROM approvals WHERE request_id = ? AND step = ? LIMIT 1',
      [id, nextStep]
    );

    if (nextRows.length > 0) {
      await conn.execute('UPDATE approvals SET status = ? WHERE id = ?', ['pending', nextRows[0].id]);
    }

    await updateRequestStatus(conn, id);

    // Record action in request_history
    const performer = req.user ? (req.user.name || req.user.email) : role;
    const actionText = comments ? `APPROVED by ${role}: ${comments}` : `APPROVED by ${role}`;
    await conn.execute(
      `INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)`,
      [id, actionText, performer]
    );

    await conn.commit();
    res.json({ success: true, message: 'Approved successfully' });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Approve error in approvalsController:', err);
    next(err);
  } finally {
    if (conn) conn.release();
  }
};

exports.reject = async (req, res, next) => {
  let conn;
  try {
    const role = req.user ? req.user.role : (req.body?.role || 'Accounts');
    const { request_id, requestId, comments } = req.body || {};
    const id = Number(request_id || requestId || req.params.id);
    if (!id || !Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Valid request_id required' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [requestRows] = await conn.execute('SELECT status FROM workflow_requests WHERE id = ? FOR UPDATE', [id]);
    const request = requestRows[0];
    if (!request || request.status === 'rejected' || request.status === 'approved') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Request cannot be rejected' });
    }

    const [currentRows] = await conn.execute(
      'SELECT * FROM approvals WHERE request_id = ? AND LOWER(approver_role) = LOWER(?) AND status = ? ORDER BY step ASC LIMIT 1',
      [id, role, 'pending']
    );
    let current = currentRows[0];
    if (!current) {
      const [anyRows] = await conn.execute(
        'SELECT * FROM approvals WHERE request_id = ? AND LOWER(approver_role) = LOWER(?) ORDER BY step ASC LIMIT 1',
        [id, role]
      );
      current = anyRows[0];
    }

    if (current) {
      await conn.execute('UPDATE approvals SET status = ? WHERE id = ?', ['rejected', current.id]);
    }
    await conn.execute('UPDATE workflow_requests SET status = ? WHERE id = ?', ['rejected', id]);

    // Record action in request_history
    const performer = req.user ? (req.user.name || req.user.email) : role;
    const actionText = comments ? `REJECTED by ${role}: ${comments}` : `REJECTED by ${role}`;
    await conn.execute(
      `INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)`,
      [id, actionText, performer]
    );

    await conn.commit();
    res.json({ success: true, message: 'Rejected successfully' });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Reject error in approvalsController:', err);
    next(err);
  } finally {
    if (conn) conn.release();
  }
};
