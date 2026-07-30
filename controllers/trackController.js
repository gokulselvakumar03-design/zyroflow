const pool = require('../config/db');

function parseJsonValue(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function mapRequestRow(row) {
  if (!row) return null;
  const workflow = parseJsonValue(row.workflow, []);
  const payload = parseJsonValue(row.payload, {});
  const createdAt = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : createdAt;
  const currentLevel = Number(row.current_level ?? 0);
  const currentRole = row.current_role || (Array.isArray(workflow) ? workflow[Math.min(currentLevel, Math.max(workflow.length - 1, 0))] : '') || '';
  const currentApprover = row.current_approver || currentRole || '';

  const isVerified = Number(row.payment_verified ?? 0) === 1 || String(row.payment_verification_status || '').toLowerCase() === 'verified';

  return {
    id: Number(row.id),
    title: row.title || row.type || payload.title || '',
    request_type: row.type || row.request_type || row.title || payload.request_type || '',
    type: row.type || row.request_type || row.title || payload.request_type || '',
    department: row.department || payload.department || '',
    priority: row.priority || payload.priority || '',
    description: row.description || payload.description || '',
    amount: Number(row.amount || payload.amount || 0),
    status: row.status || payload.status || 'pending',
    requester: row.requester_name || payload.requester || payload.requester_name || '',
    requester_name: row.requester_name || payload.requester || payload.requester_name || '',
    requesterEmail: row.requester_email || payload.requesterEmail || payload.email || '',
    requester_email: row.requester_email || payload.requesterEmail || payload.email || '',
    currentRole: currentRole,
    current_role: currentRole,
    currentApprover: currentApprover,
    current_approver: currentApprover,
    currentLevel,
    current_level: currentLevel,
    workflow: Array.isArray(workflow) ? workflow : [],
    payment_verified: isVerified ? 1 : 0,
    payment_verified_by: row.payment_verified_by || null,
    payment_verified_at: row.payment_verified_at || null,
    payment_verification_status: isVerified ? "Verified" : "Pending",
    payload,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
  };
}

exports.trackRequest = async (req, res, next) => {
  try {
    const requestId = Number(req.params.requestId);
    if (!requestId || !Number.isInteger(requestId)) {
      return res.status(400).json({ message: 'Invalid request ID' });
    }

    const [requests] = await pool.execute('SELECT * FROM workflow_requests WHERE id = ?', [requestId]);
    const request = requests[0];

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    // Check ownership if user is logged in as employee
    if (req.user && String(req.user.role).toLowerCase() === 'employee') {
      const userEmail = String(req.user.email || '').toLowerCase();
      const reqEmail = String(request.requester_email || '').toLowerCase();
      if (reqEmail && userEmail && reqEmail !== userEmail) {
        return res.status(403).json({ message: 'Access denied to this request' });
      }
    }

    const [approvalRows] = await pool.execute(
      `SELECT approver_role, step, status, updated_at
       FROM approvals
       WHERE request_id = ?
       ORDER BY step ASC`,
      [requestId]
    );

    const [historyRows] = await pool.execute(
      `SELECT id, request_id, action, performed_by, timestamp
       FROM request_history
       WHERE request_id = ?
       ORDER BY id ASC`,
      [requestId]
    );

    const mappedRequest = mapRequestRow(request);

    const workflow = approvalRows.map((row) => {
      let approval_time = null;
      if (row.status === 'approved' && row.updated_at && request.created_at) {
        const updatedAt = new Date(row.updated_at);
        const createdAt = new Date(request.created_at);
        const diffMs = updatedAt - createdAt;
        const diffMinutes = Math.round(diffMs / 60000);
        approval_time = `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`;
      }

      return {
        approver_role: row.approver_role,
        step: row.step,
        status: row.status,
        updated_at: row.updated_at,
        approval_time,
      };
    });

    const isVerified = Number(request.payment_verified ?? 0) === 1 || String(request.payment_verification_status || '').toLowerCase() === 'verified';

    res.json({
      request: mappedRequest,
      approvals: approvalRows,
      history: historyRows,
      workflow,
      payment_verification: {
        status: isVerified ? 'Verified' : 'Pending',
        verified_by: request.payment_verified_by || (isVerified ? 'Accounts Team' : null),
        verified_at: request.payment_verified_at || null,
      }
    });
  } catch (err) {
    next(err);
  }
};

