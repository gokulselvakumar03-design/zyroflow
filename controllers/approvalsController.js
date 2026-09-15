const pool = require('../config/db');

function getSessionId(req) {
  if (!pool.isDemoMode) return null;
  return req?.demoSessionId || req?.user?.demo_session_id || 'default';
}

async function recordApprovalHistory(conn, { request_id, decision, action, manager_name, role, comments, sessionId }) {
  try {
    const reqSql = pool.isDemoMode && sessionId
      ? 'SELECT requester_name, requester_email, department, type, title, created_at FROM workflow_requests WHERE demo_session_id = ? AND id = ?'
      : 'SELECT requester_name, requester_email, department, type, title, created_at FROM workflow_requests WHERE id = ?';
    const reqParams = pool.isDemoMode && sessionId ? [sessionId, request_id] : [request_id];

    const [reqRows] = await conn.execute(reqSql, reqParams);
    const req = reqRows[0] || {};
    const employee_name = req.requester_name || req.requester_email || 'Employee';
    const department = req.department || 'Finance';
    const request_type = req.type || req.title || 'Financial Request';
    const dec = String(decision || action || '').toLowerCase().includes('approve') ? 'Approved' : (String(decision || action || '').toLowerCase().includes('escalat') ? 'Escalated' : 'Rejected');
    const stage = role || 'Manager';
    const performer = manager_name || role || 'Manager';

    const createdAtMs = req.created_at ? new Date(req.created_at).getTime() : Date.now();
    const decision_time_seconds = Math.max(0, Math.round((Date.now() - createdAtMs) / 1000));

    // Deduplication check
    const dupSql = pool.isDemoMode && sessionId
      ? `SELECT id FROM approval_history WHERE demo_session_id = ? AND request_id = ? AND LOWER(decision) = LOWER(?) AND LOWER(approval_stage) = LOWER(?) ORDER BY id DESC LIMIT 1`
      : `SELECT id FROM approval_history WHERE request_id = ? AND LOWER(decision) = LOWER(?) AND LOWER(approval_stage) = LOWER(?) ORDER BY id DESC LIMIT 1`;
    const dupParams = pool.isDemoMode && sessionId
      ? [sessionId, request_id, dec, stage]
      : [request_id, dec, stage];

    const [existing] = await conn.execute(dupSql, dupParams);
    if (existing && existing.length > 0) {
      console.log(`[APPROVAL HISTORY] Duplicate decision entry prevented for Request #${request_id} -> ${dec} (${stage})`);
      return;
    }

    if (pool.isDemoMode && sessionId) {
      await conn.execute(`
        INSERT INTO approval_history (demo_session_id, request_id, employee_name, department, request_type, manager_name, approval_stage, decision, action, decision_timestamp, timestamp, decision_time_seconds, comments)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?)
      `, [sessionId, request_id, employee_name, department, request_type, performer, stage, dec, dec, decision_time_seconds, comments || null]);
    } else {
      await conn.execute(`
        INSERT INTO approval_history (request_id, employee_name, department, request_type, manager_name, approval_stage, decision, action, decision_timestamp, timestamp, decision_time_seconds, comments)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?)
      `, [request_id, employee_name, department, request_type, performer, stage, dec, dec, decision_time_seconds, comments || null]);
    }

    console.log(`[APPROVAL HISTORY] Saved decision: Request #${request_id} -> ${dec} (${stage})`);
  } catch (err) {
    console.error('recordApprovalHistory error:', err.message);
  }
}

exports.getPendingApprovals = async (req, res, next) => {
  try {
    const role = req.user ? req.user.role : '';
    const sessionId = getSessionId(req);

    let sql = `
      SELECT a.*, r.requester_name as employee_id, r.type as request_type, r.amount, r.description, r.status as request_status
      FROM approvals a
      JOIN workflow_requests r ON a.request_id = r.id
      WHERE LOWER(a.approver_role) = LOWER(?) AND a.status = 'pending'
    `;
    let params = [role];

    if (pool.isDemoMode && sessionId) {
      sql = `
        SELECT a.*, r.requester_name as employee_id, r.type as request_type, r.amount, r.description, r.status as request_status
        FROM approvals a
        JOIN workflow_requests r ON a.request_id = r.id
        WHERE a.demo_session_id = ? AND r.demo_session_id = ? AND LOWER(a.approver_role) = LOWER(?) AND a.status = 'pending'
      `;
      params = [sessionId, sessionId, role];
    }

    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

async function updateRequestStatus(conn, requestId, sessionId) {
  const pendingSql = pool.isDemoMode && sessionId
    ? "SELECT status, step, approver_role FROM approvals WHERE demo_session_id = ? AND request_id = ? AND status IN ('pending','waiting') ORDER BY step ASC"
    : "SELECT status, step, approver_role FROM approvals WHERE request_id = ? AND status IN ('pending','waiting') ORDER BY step ASC";
  const pendingParams = pool.isDemoMode && sessionId ? [sessionId, requestId] : [requestId];

  const [pendingRows] = await conn.execute(pendingSql, pendingParams);

  if (pendingRows.length === 0) {
    const updateSql = pool.isDemoMode && sessionId
      ? "UPDATE workflow_requests SET status = 'Approved', approval_stage = 'Completed', current_role = 'Completed', current_approver = 'Completed' WHERE demo_session_id = ? AND id = ?"
      : "UPDATE workflow_requests SET status = 'Approved', approval_stage = 'Completed', current_role = 'Completed', current_approver = 'Completed' WHERE id = ?";
    const updateParams = pool.isDemoMode && sessionId ? [sessionId, requestId] : [requestId];
    await conn.execute(updateSql, updateParams);
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
    const updateSql = pool.isDemoMode && sessionId
      ? 'UPDATE workflow_requests SET status = ?, approval_stage = ?, current_role = ?, current_approver = ?, current_level = ? WHERE demo_session_id = ? AND id = ?'
      : 'UPDATE workflow_requests SET status = ?, approval_stage = ?, current_role = ?, current_approver = ?, current_level = ? WHERE id = ?';
    const updateParams = pool.isDemoMode && sessionId
      ? [statusText, cleanRole, cleanRole, cleanRole, Number(active.step || 0), sessionId, requestId]
      : [statusText, cleanRole, cleanRole, cleanRole, Number(active.step || 0), requestId];
    await conn.execute(updateSql, updateParams);
  }
}

exports.approve = async (req, res, next) => {
  let conn;
  try {
    const userRole = req.user ? req.user.role : null;
    if (!userRole) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const role = userRole;
    const lowerRole = String(role).toLowerCase().trim();
    const sessionId = getSessionId(req);

    if (lowerRole === 'employee' || lowerRole === 'requester' || lowerRole === 'user') {
      return res.status(403).json({ success: false, message: 'Forbidden: Employees are not authorized to approve requests.' });
    }

    const { request_id, requestId, comments } = req.body || {};
    const id = Number(request_id || requestId || req.params.id);
    if (!id || !Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Valid request_id required' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const reqSql = pool.isDemoMode && sessionId
      ? 'SELECT id, status, approval_stage, current_role, payment_verified, requester_email FROM workflow_requests WHERE demo_session_id = ? AND id = ? FOR UPDATE'
      : 'SELECT id, status, approval_stage, current_role, payment_verified, requester_email FROM workflow_requests WHERE id = ? FOR UPDATE';
    const reqParams = pool.isDemoMode && sessionId ? [sessionId, id] : [id];

    const [requestRows] = await conn.execute(reqSql, reqParams);
    const request = requestRows[0];
    if (!request) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    const currentStatus = String(request.status || '').toLowerCase().trim();
    if (currentStatus === 'rejected' || currentStatus === 'approved') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Request cannot be approved' });
    }

    const pendingStepSql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM approvals WHERE demo_session_id = ? AND request_id = ? AND status = ? ORDER BY step ASC LIMIT 1'
      : 'SELECT * FROM approvals WHERE request_id = ? AND status = ? ORDER BY step ASC LIMIT 1';
    const pendingStepParams = pool.isDemoMode && sessionId ? [sessionId, id, 'pending'] : [id, 'pending'];

    const [pendingStepRows] = await conn.execute(pendingStepSql, pendingStepParams);
    let current = pendingStepRows[0];
    const currentStage = current ? current.approver_role : (request.approval_stage || request.current_role || 'Accounts');
    const normCurrentStage = String(currentStage).toLowerCase().trim();

    if (lowerRole !== normCurrentStage && lowerRole !== 'admin') {
      await conn.rollback();
      return res.status(403).json({
        success: false,
        message: `Forbidden: Role '${role}' is not authorized to approve requests at the '${currentStage}' stage.`
      });
    }

    if (!current) {
      const anySql = pool.isDemoMode && sessionId
        ? 'SELECT * FROM approvals WHERE demo_session_id = ? AND request_id = ? AND LOWER(approver_role) = LOWER(?) ORDER BY step ASC LIMIT 1'
        : 'SELECT * FROM approvals WHERE request_id = ? AND LOWER(approver_role) = LOWER(?) ORDER BY step ASC LIMIT 1';
      const anyParams = pool.isDemoMode && sessionId ? [sessionId, id, role] : [id, role];
      const [anyRows] = await conn.execute(anySql, anyParams);
      current = anyRows[0];
    }

    if (!current) {
      let nextRole = lowerRole === 'cfo' ? 'MD' : lowerRole === 'manager' ? 'CFO' : lowerRole === 'accounts' ? 'Manager' : 'Completed';
      let nextLevel = lowerRole === 'cfo' ? 3 : lowerRole === 'manager' ? 2 : lowerRole === 'accounts' ? 1 : 4;
      let statusText = nextRole === 'Completed' ? 'Approved' : `Pending ${nextRole} Approval`;

      const upSql = pool.isDemoMode && sessionId
        ? 'UPDATE workflow_requests SET status = ?, approval_stage = ?, current_role = ?, current_approver = ?, current_level = ? WHERE demo_session_id = ? AND id = ?'
        : 'UPDATE workflow_requests SET status = ?, approval_stage = ?, current_role = ?, current_approver = ?, current_level = ? WHERE id = ?';
      const upParams = pool.isDemoMode && sessionId
        ? [statusText, nextRole, nextRole, nextRole, nextLevel, sessionId, id]
        : [statusText, nextRole, nextRole, nextRole, nextLevel, id];

      await conn.execute(upSql, upParams);

      const performer = req.user ? (req.user.name || req.user.email) : role;
      if (pool.isDemoMode && sessionId) {
        await conn.execute(
          `INSERT INTO request_history (demo_session_id, request_id, action, performed_by) VALUES (?, ?, ?, ?)`,
          [sessionId, id, comments ? `APPROVED by ${role}: ${comments}` : `APPROVED by ${role}`, performer]
        );
      } else {
        await conn.execute(
          `INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)`,
          [id, comments ? `APPROVED by ${role}: ${comments}` : `APPROVED by ${role}`, performer]
        );
      }

      await recordApprovalHistory(conn, {
        request_id: id,
        action: 'Approved',
        decision: 'Approved',
        manager_name: performer,
        role: role,
        comments: comments || null,
        sessionId
      });

      if (request.requester_email && (lowerRole === 'md' || nextRole === 'Completed')) {
        if (pool.isDemoMode && sessionId) {
          await conn.execute(
            `INSERT INTO notifications (demo_session_id, user_email, user_role, request_id, title, message, type) VALUES (?, ?, 'employee', ?, 'Request Approved', 'Congratulations. Your request has been approved by MD.', 'success')`,
            [sessionId, request.requester_email, id]
          ).catch(() => {});
        } else {
          await conn.execute(
            `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'Request Approved', 'Congratulations. Your request has been approved by MD.', 'success')`,
            [request.requester_email, id]
          ).catch(() => {});
        }
      }

      await conn.commit();
      return res.json({ success: true, message: `Request approved successfully.` });
    }

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
    const nextSql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM approvals WHERE demo_session_id = ? AND request_id = ? AND step = ? LIMIT 1'
      : 'SELECT * FROM approvals WHERE request_id = ? AND step = ? LIMIT 1';
    const nextParams = pool.isDemoMode && sessionId ? [sessionId, id, nextStep] : [id, nextStep];

    const [nextRows] = await conn.execute(nextSql, nextParams);

    if (nextRows.length > 0) {
      await conn.execute('UPDATE approvals SET status = ? WHERE id = ?', ['pending', nextRows[0].id]);
    }

    await updateRequestStatus(conn, id, sessionId);

    const performer = req.user ? (req.user.name || req.user.email) : role;
    const actionText = comments ? `APPROVED by ${role}: ${comments}` : `APPROVED by ${role}`;

    if (pool.isDemoMode && sessionId) {
      await conn.execute(
        `INSERT INTO request_history (demo_session_id, request_id, action, performed_by) VALUES (?, ?, ?, ?)`,
        [sessionId, id, actionText, performer]
      );
    } else {
      await conn.execute(
        `INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)`,
        [id, actionText, performer]
      );
    }

    await recordApprovalHistory(conn, {
      request_id: id,
      action: 'Approved',
      decision: 'Approved',
      manager_name: performer,
      role: role,
      comments: comments || null,
      sessionId
    });

    const empEmail = request.requester_email;

    if (lowerRole === 'accounts') {
      if (empEmail) {
        const notifSql = pool.isDemoMode && sessionId
          ? `INSERT INTO notifications (demo_session_id, user_email, user_role, request_id, title, message, type) VALUES (?, ?, 'employee', ?, 'Accounts Approved', 'Your request has moved to Manager.', 'info')`
          : `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'Accounts Approved', 'Your request has moved to Manager.', 'info')`;
        const notifParams = pool.isDemoMode && sessionId ? [sessionId, empEmail, id] : [empEmail, id];
        await conn.execute(notifSql, notifParams).catch(() => {});
      }
      const mgrNotifSql = pool.isDemoMode && sessionId
        ? `INSERT INTO notifications (demo_session_id, user_role, request_id, title, message, type) VALUES (?, 'manager', ?, 'Approval Required', 'New request waiting for approval.', 'info')`
        : `INSERT INTO notifications (user_role, request_id, title, message, type) VALUES ('manager', ?, 'Approval Required', 'New request waiting for approval.', 'info')`;
      const mgrNotifParams = pool.isDemoMode && sessionId ? [sessionId, id] : [id];
      await conn.execute(mgrNotifSql, mgrNotifParams).catch(() => {});
    } else if (lowerRole === 'manager') {
      if (empEmail) {
        const notifSql = pool.isDemoMode && sessionId
          ? `INSERT INTO notifications (demo_session_id, user_email, user_role, request_id, title, message, type) VALUES (?, ?, 'employee', ?, 'Manager Approved', 'Manager approved your request. Waiting for CFO.', 'info')`
          : `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'Manager Approved', 'Manager approved your request. Waiting for CFO.', 'info')`;
        const notifParams = pool.isDemoMode && sessionId ? [sessionId, empEmail, id] : [empEmail, id];
        await conn.execute(notifSql, notifParams).catch(() => {});
      }
      const cfoNotifSql = pool.isDemoMode && sessionId
        ? `INSERT INTO notifications (demo_session_id, user_role, request_id, title, message, type) VALUES (?, 'cfo', ?, 'Approval Required', 'Manager approved a request. Waiting for your approval.', 'info')`
        : `INSERT INTO notifications (user_role, request_id, title, message, type) VALUES ('cfo', ?, 'Approval Required', 'Manager approved a request. Waiting for your approval.', 'info')`;
      const cfoNotifParams = pool.isDemoMode && sessionId ? [sessionId, id] : [id];
      await conn.execute(cfoNotifSql, cfoNotifParams).catch(() => {});
    } else if (lowerRole === 'cfo') {
      if (empEmail) {
        const notifSql = pool.isDemoMode && sessionId
          ? `INSERT INTO notifications (demo_session_id, user_email, user_role, request_id, title, message, type) VALUES (?, ?, 'employee', ?, 'CFO Approved', 'Waiting for MD Approval.', 'info')`
          : `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'CFO Approved', 'Waiting for MD Approval.', 'info')`;
        const notifParams = pool.isDemoMode && sessionId ? [sessionId, empEmail, id] : [empEmail, id];
        await conn.execute(notifSql, notifParams).catch(() => {});
      }
      const mdNotifSql = pool.isDemoMode && sessionId
        ? `INSERT INTO notifications (demo_session_id, user_role, request_id, title, message, type) VALUES (?, 'md', ?, 'Approval Required', 'CFO approved request. Waiting for final approval.', 'info')`
        : `INSERT INTO notifications (user_role, request_id, title, message, type) VALUES ('md', ?, 'Approval Required', 'CFO approved request. Waiting for final approval.', 'info')`;
      const mdNotifParams = pool.isDemoMode && sessionId ? [sessionId, id] : [id];
      await conn.execute(mdNotifSql, mdNotifParams).catch(() => {});
    } else if (lowerRole === 'md' || nextRows.length === 0) {
      if (empEmail) {
        const notifSql = pool.isDemoMode && sessionId
          ? `INSERT INTO notifications (demo_session_id, user_email, user_role, request_id, title, message, type) VALUES (?, ?, 'employee', ?, 'Request Approved', 'Congratulations. Your request has been approved.', 'success')`
          : `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'Request Approved', 'Congratulations. Your request has been approved.', 'success')`;
        const notifParams = pool.isDemoMode && sessionId ? [sessionId, empEmail, id] : [empEmail, id];
        await conn.execute(notifSql, notifParams).catch(() => {});
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
    const sessionId = getSessionId(req);

    if (!id || !Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Valid request_id required' });

    const reasonStr = comments ? String(comments).trim() : '';
    if (!reasonStr) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const reqSql = pool.isDemoMode && sessionId
      ? 'SELECT status, requester_email FROM workflow_requests WHERE demo_session_id = ? AND id = ? FOR UPDATE'
      : 'SELECT status, requester_email FROM workflow_requests WHERE id = ? FOR UPDATE';
    const reqParams = pool.isDemoMode && sessionId ? [sessionId, id] : [id];

    const [requestRows] = await conn.execute(reqSql, reqParams);
    const request = requestRows[0];
    const currentStatus = String(request ? request.status : '').toLowerCase().trim();
    if (!request || currentStatus === 'rejected' || currentStatus === 'approved') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Request cannot be rejected' });
    }

    const currSql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM approvals WHERE demo_session_id = ? AND request_id = ? AND LOWER(approver_role) = LOWER(?) AND status = ? ORDER BY step ASC LIMIT 1'
      : 'SELECT * FROM approvals WHERE request_id = ? AND LOWER(approver_role) = LOWER(?) AND status = ? ORDER BY step ASC LIMIT 1';
    const currParams = pool.isDemoMode && sessionId ? [sessionId, id, role, 'pending'] : [id, role, 'pending'];

    const [currentRows] = await conn.execute(currSql, currParams);
    let current = currentRows[0];
    if (!current) {
      const anySql = pool.isDemoMode && sessionId
        ? 'SELECT * FROM approvals WHERE demo_session_id = ? AND request_id = ? AND LOWER(approver_role) = LOWER(?) ORDER BY step ASC LIMIT 1'
        : 'SELECT * FROM approvals WHERE request_id = ? AND LOWER(approver_role) = LOWER(?) ORDER BY step ASC LIMIT 1';
      const anyParams = pool.isDemoMode && sessionId ? [sessionId, id, role] : [id, role];
      const [anyRows] = await conn.execute(anySql, anyParams);
      current = anyRows[0];
    }

    if (current) {
      try {
        await conn.execute('UPDATE approvals SET status = ?, comments = ? WHERE id = ?', ['rejected', reasonStr, current.id]);
      } catch (e) {
        await conn.execute('UPDATE approvals SET status = ? WHERE id = ?', ['rejected', current.id]);
      }
    }

    const upReqSql = pool.isDemoMode && sessionId
      ? "UPDATE workflow_requests SET status = 'Rejected', approval_stage = 'Rejected', current_role = 'Rejected', current_approver = 'Rejected', rejection_reason = ? WHERE demo_session_id = ? AND id = ?"
      : "UPDATE workflow_requests SET status = 'Rejected', approval_stage = 'Rejected', current_role = 'Rejected', current_approver = 'Rejected', rejection_reason = ? WHERE id = ?";
    const upReqParams = pool.isDemoMode && sessionId ? [reasonStr, sessionId, id] : [reasonStr, id];

    await conn.execute(upReqSql, upReqParams);

    const performer = req.user ? (req.user.name || req.user.email) : role;
    const actionText = `REJECTED by ${role}: ${reasonStr}`;

    if (pool.isDemoMode && sessionId) {
      await conn.execute(
        `INSERT INTO request_history (demo_session_id, request_id, action, performed_by, comments) VALUES (?, ?, ?, ?, ?)`,
        [sessionId, id, actionText, performer, reasonStr]
      );
    } else {
      await conn.execute(
        `INSERT INTO request_history (request_id, action, performed_by, comments) VALUES (?, ?, ?, ?)`,
        [id, actionText, performer, reasonStr]
      );
    }

    await recordApprovalHistory(conn, {
      request_id: id,
      action: 'Rejected',
      decision: 'Rejected',
      manager_name: performer,
      role: role,
      comments: reasonStr,
      sessionId
    });

    if (request && request.requester_email) {
      const notifSql = pool.isDemoMode && sessionId
        ? `INSERT INTO notifications (demo_session_id, user_email, user_role, request_id, title, message, type) VALUES (?, ?, 'employee', ?, 'Request Rejected', ?, 'error')`
        : `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'Request Rejected', ?, 'error')`;
      const notifParams = pool.isDemoMode && sessionId
        ? [sessionId, request.requester_email, id, `Request rejected by ${role}: ${reasonStr}`]
        : [request.requester_email, id, `Request rejected by ${role}: ${reasonStr}`];
      await conn.execute(notifSql, notifParams).catch(() => {});
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
    const sessionId = getSessionId(req);

    if (!id || !Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Valid request_id required' });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const reqSql = pool.isDemoMode && sessionId
      ? 'SELECT status, requester_email, workflow, current_level FROM workflow_requests WHERE demo_session_id = ? AND id = ? FOR UPDATE'
      : 'SELECT status, requester_email, workflow, current_level FROM workflow_requests WHERE id = ? FOR UPDATE';
    const reqParams = pool.isDemoMode && sessionId ? [sessionId, id] : [id];

    const [requestRows] = await conn.execute(reqSql, reqParams);
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

    const upReqSql = pool.isDemoMode && sessionId
      ? "UPDATE workflow_requests SET status = 'Pending MD Approval', approval_stage = 'MD', current_role = 'MD', current_approver = 'MD', current_level = ? WHERE demo_session_id = ? AND id = ?"
      : "UPDATE workflow_requests SET status = 'Pending MD Approval', approval_stage = 'MD', current_role = 'MD', current_approver = 'MD', current_level = ? WHERE id = ?";
    const upReqParams = pool.isDemoMode && sessionId ? [nextLevel, sessionId, id] : [nextLevel, id];

    await conn.execute(upReqSql, upReqParams);

    const upAppr1Sql = pool.isDemoMode && sessionId
      ? "UPDATE approvals SET status = 'approved', updated_at = NOW() WHERE demo_session_id = ? AND request_id = ? AND LOWER(approver_role) = LOWER(?)"
      : "UPDATE approvals SET status = 'approved', updated_at = NOW() WHERE request_id = ? AND LOWER(approver_role) = LOWER(?)";
    const upAppr1Params = pool.isDemoMode && sessionId ? [sessionId, id, role] : [id, role];
    await conn.execute(upAppr1Sql, upAppr1Params);

    const upAppr2Sql = pool.isDemoMode && sessionId
      ? "UPDATE approvals SET status = 'pending', updated_at = NOW() WHERE demo_session_id = ? AND request_id = ? AND LOWER(approver_role) = 'md'"
      : "UPDATE approvals SET status = 'pending', updated_at = NOW() WHERE request_id = ? AND LOWER(approver_role) = 'md'";
    const upAppr2Params = pool.isDemoMode && sessionId ? [sessionId, id] : [id];
    await conn.execute(upAppr2Sql, upAppr2Params);

    if (pool.isDemoMode && sessionId) {
      await conn.execute(
        `INSERT INTO request_history (demo_session_id, request_id, action, performed_by) VALUES (?, ?, ?, ?)`,
        [sessionId, id, actionText, performer]
      );
    } else {
      await conn.execute(
        `INSERT INTO request_history (request_id, action, performed_by) VALUES (?, ?, ?)`,
        [id, actionText, performer]
      );
    }

    await recordApprovalHistory(conn, {
      request_id: id,
      action: 'Escalated',
      decision: 'Escalated',
      manager_name: performer,
      role: role,
      comments: comments || 'Escalated to MD for executive review',
      sessionId
    });

    const mdNotifSql = pool.isDemoMode && sessionId
      ? `INSERT INTO notifications (demo_session_id, user_role, request_id, title, message, type) VALUES (?, 'md', ?, 'Escalated Request', 'Request escalated to MD for executive review.', 'warning')`
      : `INSERT INTO notifications (user_role, request_id, title, message, type) VALUES ('md', ?, 'Escalated Request', 'Request escalated to MD for executive review.', 'warning')`;
    const mdNotifParams = pool.isDemoMode && sessionId ? [sessionId, id] : [id];
    await conn.execute(mdNotifSql, mdNotifParams).catch(() => {});

    if (request.requester_email) {
      const empNotifSql = pool.isDemoMode && sessionId
        ? `INSERT INTO notifications (demo_session_id, user_email, user_role, request_id, title, message, type) VALUES (?, ?, 'employee', ?, 'Request Escalated to MD', 'Your request has been escalated to MD by CFO.', 'info')`
        : `INSERT INTO notifications (user_email, user_role, request_id, title, message, type) VALUES (?, 'employee', ?, 'Request Escalated to MD', 'Your request has been escalated to MD by CFO.', 'info')`;
      const empNotifParams = pool.isDemoMode && sessionId ? [sessionId, request.requester_email, id] : [request.requester_email, id];
      await conn.execute(empNotifSql, empNotifParams).catch(() => {});
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
