const pool = require('../config/db');

async function recordApprovalHistory(conn, { request_id, decision, action, manager_name, role, comments }) {
  try {
    const [reqRows] = await conn.execute(
      'SELECT requester_name, requester_email, department, type, title, created_at FROM workflow_requests WHERE id = ?',
      [request_id]
    );
    const req = reqRows[0] || {};
    const employee_name = req.requester_name || req.requester_email || 'Employee';
    const department = req.department || 'Finance';
    const request_type = req.type || req.title || 'Financial Request';
    const dec = String(decision || action || '').toLowerCase().includes('approve') ? 'Approved' : 'Rejected';
    const stage = role || 'Manager';
    const performer = manager_name || role || 'Manager';

    const createdAtMs = req.created_at ? new Date(req.created_at).getTime() : Date.now();
    const decision_time_seconds = Math.max(0, Math.round((Date.now() - createdAtMs) / 1000));

    // Deduplication check: prevent duplicate insertion for the same request decision & stage
    const [existing] = await conn.execute(
      `SELECT id FROM approval_history WHERE request_id = ? AND LOWER(decision) = LOWER(?) AND LOWER(approval_stage) = LOWER(?) ORDER BY id DESC LIMIT 1`,
      [request_id, dec, stage]
    );
    if (existing && existing.length > 0) {
      console.log(`[APPROVAL HISTORY] Duplicate decision entry prevented for Request #${request_id} -> ${dec} (${stage})`);
      return;
    }

    await conn.execute(`
      INSERT INTO approval_history (request_id, employee_name, department, request_type, manager_name, approval_stage, decision, action, decision_timestamp, timestamp, decision_time_seconds, comments)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?)
    `, [request_id, employee_name, department, request_type, performer, stage, dec, dec, decision_time_seconds, comments || null]);

    console.log(`[APPROVAL HISTORY] Saved Manager decision in controller: Request #${request_id} -> ${dec} (Comments: ${comments || 'None'})`);
  } catch (err) {
    console.error('recordApprovalHistory error:', err.message);
  }
}

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
    await conn.execute(
      "UPDATE workflow_requests SET status = 'Approved', approval_stage = 'Completed', current_role = 'Completed', current_approver = 'Completed' WHERE id = ?",
      [requestId]
    );
  } else {
    const active = pendingRows.find(r => r.status === 'pending') || pendingRows[0];
    const role = active.approver_role;
    let cleanRole = 'Manager';
    const lower = String(role).toLowerCase().trim();
    if (lower === 'manager') cleanRole = 'Manager';
    else if (lower === 'cfo') cleanRole = 'CFO';
    else if (lower === 'md') cleanRole = 'MD';
    else if (lower === 'accounts') cleanRole = 'Accounts';

    const statusText = `Pending ${cleanRole} Approval`;
    await conn.execute(
      'UPDATE workflow_requests SET status = ?, approval_stage = ?, current_role = ?, current_approver = ?, current_level = ? WHERE id = ?',
      [statusText, cleanRole, cleanRole, cleanRole, Number(active.step || 0), requestId]
    );
  }
}

exports.approve = async (req, res, next) => {
  let conn;
  try {
    const role = req.body?.role || (req.user ? req.user.role : 'Accounts');
    const { request_id, requestId, comments } = req.body || {};
    const id = Number(request_id || requestId || req.params.id);
    if (!id || !Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Valid request_id required' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [requestRows] = await conn.execute('SELECT status, payment_verified, current_role, requester_email FROM workflow_requests WHERE id = ? FOR UPDATE', [id]);
    const request = requestRows[0];
    const currentStatus = String(request ? request.status : '').toLowerCase().trim();
    if (!request || currentStatus === 'rejected' || currentStatus === 'approved') {
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

    const lowerRole = String(role).toLowerCase().trim();

    if (!current) {
      let nextRole = lowerRole === 'cfo' ? 'MD' : lowerRole === 'manager' ? 'CFO' : lowerRole === 'accounts' ? 'Manager' : 'Completed';
      let nextLevel = lowerRole === 'cfo' ? 3 : lowerRole === 'manager' ? 2 : lowerRole === 'accounts' ? 1 : 4;
      let statusText = nextRole === 'Completed' ? 'Approved' : `Pending ${nextRole} Approval`;

      await conn.execute(
        'UPDATE workflow_requests SET status = ?, approval_stage = ?, current_role = ?, current_approver = ?, current_level = ? WHERE id = ?',
        [statusText, nextRole, nextRole, nextRole, nextLevel, id]
      );
      await conn.execute(
        `INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)`,
        [id, comments ? `APPROVED by ${role}: ${comments}` : `APPROVED by ${role}`, req.user ? (req.user.name || req.user.email) : role]
      );

      const performer = req.user ? (req.user.name || req.user.email) : role;
      await recordApprovalHistory(conn, {
        request_id: id,
        action: 'Approved',
        decision: 'Approved',
        manager_name: performer,
        role: role,
        comments: comments || null
      });

      if (request.requester_email && (lowerRole === 'md' || nextRole === 'Completed')) {
        await conn.execute(
          `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'Request Approved', 'Congratulations. Your request has been approved by MD.', 'success')`,
          [request.requester_email, id]
        ).catch(() => {});
      }

      await conn.commit();
      return res.json({ success: true, message: `Request approved successfully.` });
    }

    // Modify ONLY Accounts approval: Check payment_verified before moving to Manager
    const isAccountsRole = lowerRole === 'accounts' || String(current.approver_role || request.current_role).toLowerCase() === 'accounts';
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

    try {
      await conn.execute('UPDATE approvals SET status = ?, comments = ? WHERE id = ?', ['approved', comments || null, current.id]);
    } catch (e) {
      await conn.execute('UPDATE approvals SET status = ? WHERE id = ?', ['approved', current.id]);
    }

    const nextStep = current.step + 1;
    const [nextRows] = await conn.execute(
      'SELECT * FROM approvals WHERE request_id = ? AND step = ? LIMIT 1',
      [id, nextStep]
    );

    if (nextRows.length > 0) {
      await conn.execute('UPDATE approvals SET status = ? WHERE id = ?', ['pending', nextRows[0].id]);
    }

    await updateRequestStatus(conn, id);

    // Record action in request_history and approval_history
    const performer = req.user ? (req.user.name || req.user.email) : role;
    const actionText = comments ? `APPROVED by ${role}: ${comments}` : `APPROVED by ${role}`;
    await conn.execute(
      `INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)`,
      [id, actionText, performer]
    );

    await recordApprovalHistory(conn, {
      request_id: id,
      action: 'Approved',
      decision: 'Approved',
      manager_name: performer,
      role: role,
      comments: comments || null
    });

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
    res.json({ success: true, message: 'Request approved successfully.' });
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
    const role = req.body?.role || (req.user ? req.user.role : 'Accounts');
    const { request_id, requestId, comments } = req.body || {};
    const id = Number(request_id || requestId || req.params.id);
    if (!id || !Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Valid request_id required' });

    const reasonStr = comments ? String(comments).trim() : '';
    if (!reasonStr) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [requestRows] = await conn.execute('SELECT status, requester_email FROM workflow_requests WHERE id = ? FOR UPDATE', [id]);
    const request = requestRows[0];
    const currentStatus = String(request ? request.status : '').toLowerCase().trim();
    if (!request || currentStatus === 'rejected' || currentStatus === 'approved') {
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
      try {
        await conn.execute('UPDATE approvals SET status = ?, comments = ? WHERE id = ?', ['rejected', reasonStr, current.id]);
      } catch (e) {
        await conn.execute('UPDATE approvals SET status = ? WHERE id = ?', ['rejected', current.id]);
      }
    }
    try {
      await conn.execute(
        "UPDATE workflow_requests SET status = 'Rejected', approval_stage = 'Rejected', current_role = 'Rejected', current_approver = 'Rejected', rejection_reason = ? WHERE id = ?",
        [reasonStr, id]
      );
    } catch (e) {
      await conn.execute(
        "UPDATE workflow_requests SET status = 'Rejected', approval_stage = 'Rejected', current_role = 'Rejected', current_approver = 'Rejected' WHERE id = ?",
        [id]
      );
    }

    // Record action in request_history and approval_history
    const performer = req.user ? (req.user.name || req.user.email) : role;
    const actionText = `REJECTED by ${role}: ${reasonStr}`;
    await conn.execute(
      `INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)`,
      [id, actionText, performer]
    );

    await recordApprovalHistory(conn, {
      request_id: id,
      action: 'Rejected',
      decision: 'Rejected',
      manager_name: performer,
      role: role,
      comments: reasonStr
    });

    // Notification for Employee: Request rejected by [Role]
    if (request && request.requester_email) {
      await conn.execute(
        `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'Request Rejected', ?, 'error')`,
        [request.requester_email, id, `Request rejected by ${role}: ${reasonStr}`]
      ).catch(() => {});
    }

    await conn.commit();
    res.json({ success: true, message: 'Request rejected successfully.' });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Reject error in approvalsController:', err);
    next(err);
  } finally {
    if (conn) conn.release();
  }
};

exports.escalate = async (req, res, next) => {
  let conn;
  try {
    const role = req.user ? req.user.role : (req.body?.role || 'CFO');
    const { request_id, requestId, comments } = req.body || {};
    const id = Number(request_id || requestId || req.params.id);
    if (!id || !Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Valid request_id required' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [requestRows] = await conn.execute('SELECT status, requester_email, workflow, current_level FROM workflow_requests WHERE id = ? FOR UPDATE', [id]);
    const request = requestRows[0];
    if (!request) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    let wf = [];
    try { wf = typeof request.workflow === 'string' ? JSON.parse(request.workflow) : (request.workflow || []); } catch(e) { wf = []; }
    const mdIndex = wf.findIndex(r => String(r).toLowerCase().trim() === 'md');
    const nextLevel = mdIndex !== -1 ? mdIndex : Math.max(1, Number(request.current_level || 0) + 1);

    const performer = req.user ? (req.user.name || req.user.email) : role;
    const actionText = comments ? `ESCALATED to MD by ${role}: ${comments}` : `ESCALATED to MD by ${role}`;

    await conn.execute(
      "UPDATE workflow_requests SET status = 'Pending MD Approval', approval_stage = 'MD', current_role = 'MD', current_approver = 'MD', current_level = ? WHERE id = ?",
      [nextLevel, id]
    );

    // Update approvals table steps
    await conn.execute(
      "UPDATE approvals SET status = 'approved', updated_at = NOW() WHERE request_id = ? AND LOWER(approver_role) = LOWER(?)",
      [id, role]
    );
    await conn.execute(
      "UPDATE approvals SET status = 'pending', updated_at = NOW() WHERE request_id = ? AND LOWER(approver_role) = 'md'",
      [id]
    );

    await conn.execute(
      `INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)`,
      [id, actionText, performer]
    );

    await recordApprovalHistory(conn, {
      request_id: id,
      action: 'Escalated',
      decision: 'Escalated',
      manager_name: performer,
      role: role,
      comments: comments || 'Escalated to MD for executive review'
    });

    await conn.execute(
      `INSERT INTO notifications (user_role, request_id, title, message, type) VALUES ('md', ?, 'Escalated Request', 'Request escalated to MD for executive review.', 'warning')`,
      [id]
    ).catch(() => {});

    if (request.requester_email) {
      await conn.execute(
        `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'Request Escalated to MD', 'Your request has been escalated to MD by CFO.', 'info')`,
        [request.requester_email, id]
      ).catch(() => {});
    }

    await conn.commit();
    res.json({ success: true, message: 'Request escalated to MD successfully' });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Escalate error in approvalsController:', err);
    next(err);
  } finally {
    if (conn) conn.release();
  }
};

