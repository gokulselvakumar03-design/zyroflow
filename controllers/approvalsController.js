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

    const [requestRows] = await conn.execute('SELECT status, payment_verified, current_role, requester_email FROM workflow_requests WHERE id = ? FOR UPDATE', [id]);
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

    // Modify ONLY Accounts approval: Check payment_verified before moving to Manager
    const isAccountsRole = String(role).toLowerCase() === 'accounts' || String(current.approver_role || request.current_role).toLowerCase() === 'accounts';
    if (isAccountsRole) {
      const isVerified = Number(request.payment_verified ?? 0) === 1;
      if (!isVerified) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: 'Payment Verification must be completed before approving this request.'
        });
      }
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

    const lowerRole = String(role).toLowerCase().trim();
    const empEmail = request.requester_email;

    // Send notifications based on approver role
    if (lowerRole === 'accounts') {
      if (empEmail) {
        await conn.execute(
          `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'Accounts Approved', 'Your request has moved to Manager.', 'info')`,
          [empEmail, id]
        ).catch(() => {});
      }
      await conn.execute(
        `INSERT INTO notifications (user_role, request_id, title, message, type) VALUES ('manager', ?, 'Approval Required', 'New request waiting for approval.', 'info')`,
        [id]
      ).catch(() => {});
    } else if (lowerRole === 'manager') {
      if (empEmail) {
        await conn.execute(
          `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'Manager Approved', 'Manager approved your request. Waiting for CFO.', 'info')`,
          [empEmail, id]
        ).catch(() => {});
      }
      await conn.execute(
        `INSERT INTO notifications (user_role, request_id, title, message, type) VALUES ('cfo', ?, 'Approval Required', 'Manager approved a request. Waiting for your approval.', 'info')`,
        [id]
      ).catch(() => {});
    } else if (lowerRole === 'cfo') {
      if (empEmail) {
        await conn.execute(
          `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'CFO Approved', 'Waiting for MD Approval.', 'info')`,
          [empEmail, id]
        ).catch(() => {});
      }
      await conn.execute(
        `INSERT INTO notifications (user_role, request_id, title, message, type) VALUES ('md', ?, 'Approval Required', 'CFO approved request. Waiting for final approval.', 'info')`,
        [id]
      ).catch(() => {});
    } else if (lowerRole === 'md' || nextRows.length === 0) {
      if (empEmail) {
        await conn.execute(
          `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'Request Approved', 'Congratulations. Your request has been approved.', 'success')`,
          [empEmail, id]
        ).catch(() => {});
      }
    }

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

    const [requestRows] = await conn.execute('SELECT status, requester_email FROM workflow_requests WHERE id = ? FOR UPDATE', [id]);
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

    // Notification for Employee: Request rejected by [Role]
    if (request && request.requester_email) {
      await conn.execute(
        `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'Request Rejected', ?, 'error')`,
        [request.requester_email, id, `Request rejected by ${role}`]
      ).catch(() => {});
    }

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
