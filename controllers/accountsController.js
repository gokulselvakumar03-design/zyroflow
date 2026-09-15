// Accounts Controller
// Module Features: Queue, Payment Verification, Budget Analysis, Financial Alerts, Analytics Charts, Export, Notifications

const pool = require('../config/db');

function getSessionId(req) {
  if (!pool.isDemoMode) return null;
  return req?.demoSessionId || req?.user?.demo_session_id || 'default';
}

function parseJsonValue(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function mapAccountRequestRow(row) {
  const workflow = parseJsonValue(row.workflow, []);
  const payload = parseJsonValue(row.payload, {});
  const createdAt = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : createdAt;
  const currentLevel = Number(row.current_level ?? 0);
  const currentRole = row.current_role || (Array.isArray(workflow) ? workflow[Math.min(currentLevel, Math.max(workflow.length - 1, 0))] : 'Accounts') || 'Accounts';
  const currentApprover = row.current_approver || currentRole || 'Accounts';
  const approvalStage = row.approval_stage || currentRole || 'Accounts';

  const employeeEmail = row.requester_email || payload.requesterEmail || payload.email || '';
  let employeeName = row.requester_name || payload.requester_name || payload.requester || payload.employee || '';
  if (!employeeName || employeeName === 'Employee' || employeeName === 'undefined') {
    if (employeeEmail.includes('employee1')) employeeName = 'Gokul';
    else if (employeeEmail.includes('employee2') || employeeEmail.includes('employee3')) employeeName = 'Ravi';
    else employeeName = 'Employee';
  }
  const employeeId = employeeEmail.includes('employee1') ? 'EMP-01' : (employeeEmail.includes('employee2') || employeeEmail.includes('employee3') ? 'EMP-02' : 'EMP-01');

  const isVerified = Number(row.payment_verified ?? 0) === 1 || String(row.payment_verification_status).toLowerCase() === 'verified';

  return {
    id: Number(row.id),
    title: row.title || row.type || payload.title || 'Financial Request',
    type: row.type || row.request_type || row.title || payload.request_type || 'financial',
    request_type: row.type || row.request_type || row.title || payload.request_type || 'financial',
    department: row.department || payload.department || 'Finance',
    priority: row.priority || payload.priority || 'medium',
    description: row.description || payload.description || '',
    amount: Number(row.amount || payload.amount || 0),
    status: row.status || payload.status || 'pending',
    approval_stage: approvalStage,
    approvalStage: approvalStage,
    requester: employeeName,
    requester_name: employeeName,
    employee: employeeName,
    employee_name: employeeName,
    employee_id: employeeId,
    employeeId: employeeId,
    requesterEmail: employeeEmail,
    requester_email: employeeEmail,
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
    payment_verification_status: isVerified ? 'Verified' : 'Unverified',
    accounts_decision: row.accounts_decision || null,
    payload,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
  };
}

/**
 * GET /accounts/requests
 * Fetches financial requests, attaching their approvals array and Accounts decision
 */
exports.getAccountsRequests = async (req, res, next) => {
  try {
    const sessionId = getSessionId(req);

    const baseSql = pool.isDemoMode && sessionId
      ? `
        SELECT wr.*,
               (
                 SELECT LOWER(a.status) 
                 FROM approvals a 
                 WHERE a.demo_session_id = ? AND a.request_id = wr.id AND LOWER(a.approver_role) = 'accounts' 
                 ORDER BY a.id DESC LIMIT 1
               ) AS accounts_approval_status,
               (
                 SELECT LOWER(ah.decision) 
                 FROM approval_history ah 
                 WHERE ah.demo_session_id = ? AND ah.request_id = wr.id AND LOWER(ah.approval_stage) = 'accounts' 
                 ORDER BY ah.id DESC LIMIT 1
               ) AS accounts_history_decision,
               COALESCE(
                 (SELECT LOWER(a.status) FROM approvals a WHERE a.demo_session_id = ? AND a.request_id = wr.id AND LOWER(a.approver_role) = 'accounts' ORDER BY a.id DESC LIMIT 1),
                 (SELECT LOWER(ah.decision) FROM approval_history ah WHERE ah.demo_session_id = ? AND ah.request_id = wr.id AND LOWER(ah.approval_stage) = 'accounts' ORDER BY ah.id DESC LIMIT 1),
                 'pending'
               ) AS accounts_decision
        FROM workflow_requests wr
        WHERE wr.demo_session_id = ?
        ORDER BY wr.id DESC
      `
      : `
        SELECT wr.*,
               (
                 SELECT LOWER(a.status) 
                 FROM approvals a 
                 WHERE a.request_id = wr.id AND LOWER(a.approver_role) = 'accounts' 
                 ORDER BY a.id DESC LIMIT 1
               ) AS accounts_approval_status,
               (
                 SELECT LOWER(ah.decision) 
                 FROM approval_history ah 
                 WHERE ah.request_id = wr.id AND LOWER(ah.approval_stage) = 'accounts' 
                 ORDER BY ah.id DESC LIMIT 1
               ) AS accounts_history_decision,
               COALESCE(
                 (SELECT LOWER(a.status) FROM approvals a WHERE a.request_id = wr.id AND LOWER(a.approver_role) = 'accounts' ORDER BY a.id DESC LIMIT 1),
                 (SELECT LOWER(ah.decision) FROM approval_history ah WHERE ah.request_id = wr.id AND LOWER(ah.approval_stage) = 'accounts' ORDER BY ah.id DESC LIMIT 1),
                 'pending'
               ) AS accounts_decision
        FROM workflow_requests wr
        ORDER BY wr.id DESC
      `;

    const baseParams = pool.isDemoMode && sessionId
      ? [sessionId, sessionId, sessionId, sessionId, sessionId]
      : [];

    const [rows] = await pool.query(baseSql, baseParams);

    const requestIds = rows.map(r => r.id).filter(Boolean);
    let approvalsMap = {};
    if (requestIds.length > 0) {
      const appSql = pool.isDemoMode && sessionId
        ? `SELECT * FROM approvals WHERE demo_session_id = ? AND request_id IN (${requestIds.map(() => '?').join(',')}) ORDER BY step ASC`
        : `SELECT * FROM approvals WHERE request_id IN (${requestIds.map(() => '?').join(',')}) ORDER BY step ASC`;
      const appParams = pool.isDemoMode && sessionId
        ? [sessionId, ...requestIds]
        : requestIds;

      const [appRows] = await pool.query(appSql, appParams).catch(() => [[]]);

      appRows.forEach(a => {
        if (!approvalsMap[a.request_id]) approvalsMap[a.request_id] = [];
        approvalsMap[a.request_id].push(a);
      });
    }

    const formattedRequests = rows.map(r => {
      const mapped = mapAccountRequestRow(r);
      mapped.approvals = approvalsMap[r.id] || [];
      mapped.accounts_approval_status = r.accounts_approval_status || null;
      mapped.accounts_history_decision = r.accounts_history_decision || null;

      const isPv = Number(r.payment_verified ?? 0) === 1 || String(r.payment_verification_status || '').toLowerCase() === 'verified';
      let accDec = r.accounts_decision || 'pending';
      if (accDec === 'approved' && !isPv) {
        accDec = 'pending';
      }
      mapped.accounts_decision = accDec;

      return mapped;
    });

    res.json(formattedRequests);
  } catch (err) {
    console.error('[AccountsController] Error fetching accounts requests:', err.message);
    next(err);
  }
};

/**
 * GET /accounts/payment-verification
 */
exports.getPaymentVerification = async (req, res, next) => {
  try {
    const sessionId = getSessionId(req);

    const unverifiedSql = pool.isDemoMode && sessionId
      ? `
        SELECT * FROM workflow_requests
        WHERE demo_session_id = ?
          AND (LOWER(status) = 'pending' OR LOWER(status) LIKE 'pending%')
          AND (LOWER(current_role) = 'accounts' OR LOWER(current_approver) = 'accounts')
          AND LOWER(status) NOT LIKE '%reject%'
          AND LOWER(status) NOT LIKE '%cancel%'
          AND (payment_verified IS NULL OR payment_verified = 0 OR LOWER(payment_verification_status) != 'verified')
        ORDER BY id DESC
      `
      : `
        SELECT * FROM workflow_requests
        WHERE (LOWER(status) = 'pending' OR LOWER(status) LIKE 'pending%')
          AND (LOWER(current_role) = 'accounts' OR LOWER(current_approver) = 'accounts')
          AND LOWER(status) NOT LIKE '%reject%'
          AND LOWER(status) NOT LIKE '%cancel%'
          AND (payment_verified IS NULL OR payment_verified = 0 OR LOWER(payment_verification_status) != 'verified')
        ORDER BY id DESC
      `;
    const unverifiedParams = pool.isDemoMode && sessionId ? [sessionId] : [];
    const [unverifiedRows] = await pool.query(unverifiedSql, unverifiedParams);

    const allAccountsSql = pool.isDemoMode && sessionId
      ? `
        SELECT * FROM workflow_requests
        WHERE demo_session_id = ?
          AND (LOWER(status) = 'pending' OR LOWER(status) LIKE 'pending%')
          AND (LOWER(current_role) = 'accounts' OR LOWER(current_approver) = 'accounts')
          AND LOWER(status) NOT LIKE '%reject%'
          AND LOWER(status) NOT LIKE '%cancel%'
        ORDER BY id DESC
      `
      : `
        SELECT * FROM workflow_requests
        WHERE (LOWER(status) = 'pending' OR LOWER(status) LIKE 'pending%')
          AND (LOWER(current_role) = 'accounts' OR LOWER(current_approver) = 'accounts')
          AND LOWER(status) NOT LIKE '%reject%'
          AND LOWER(status) NOT LIKE '%cancel%'
        ORDER BY id DESC
      `;
    const allAccountsParams = pool.isDemoMode && sessionId ? [sessionId] : [];
    const [allAccountsRows] = await pool.query(allAccountsSql, allAccountsParams);

    const pvSql = pool.isDemoMode && sessionId
      ? `
        SELECT pv.*, wr.title, wr.amount, wr.requester_name
        FROM payment_verifications pv
        JOIN workflow_requests wr ON pv.request_id = wr.id
        WHERE pv.demo_session_id = ? AND wr.demo_session_id = ?
        ORDER BY pv.id DESC
      `
      : `
        SELECT pv.*, wr.title, wr.amount, wr.requester_name
        FROM payment_verifications pv
        JOIN workflow_requests wr ON pv.request_id = wr.id
        ORDER BY pv.id DESC
      `;
    const pvParams = pool.isDemoMode && sessionId ? [sessionId, sessionId] : [];
    const [verifications] = await pool.query(pvSql, pvParams).catch(() => [[]]);

    const formatPvItem = (row) => {
      const mapped = mapAccountRequestRow(row);
      const dept = mapped.department || 'Finance';
      let vendorName = `${dept} Corporate Vendor`;
      if (dept.toLowerCase() === 'it') vendorName = 'Cloud Systems & IT Hardware Inc';
      else if (dept.toLowerCase() === 'hr') vendorName = 'Global Talent & HR Solutions';
      else if (dept.toLowerCase() === 'finance') vendorName = 'Apex Financial Services LLC';
      else if (dept.toLowerCase() === 'sales') vendorName = 'Enterprise Media & Sales Group';

      return {
        ...mapped,
        invoice_number: `INV-2026-${String(mapped.id).padStart(4, '0')}`,
        vendor_name: vendorName,
        payment_method: 'Bank Wire Transfer',
        po_number: `PO-2026-${String(mapped.id).padStart(4, '0')}`,
      };
    };

    const formattedUnverified = unverifiedRows.map(formatPvItem);
    const formattedAll = allAccountsRows.map(formatPvItem);

    res.json({
      success: true,
      pending: formattedUnverified,
      all_accounts_requests: formattedAll,
      verifications: Array.isArray(verifications[0]) ? verifications[0] : (Array.isArray(verifications) ? verifications : [])
    });
  } catch (err) {
    console.error('[AccountsController] Payment Verification GET failed:', err.message);
    next(err);
  }
};

/**
 * POST /accounts/payment-verification
 */
exports.createPaymentVerification = async (req, res, next) => {
  try {
    const { request_id, remarks, verified_by } = req.body || {};
    const requestId = Number(request_id);
    const sessionId = getSessionId(req);

    if (!requestId || !Number.isInteger(requestId)) {
      return res.status(400).json({ success: false, message: 'Valid request_id is required' });
    }

    const trimmedRemarks = String(remarks || '').trim();
    if (trimmedRemarks.length < 10) {
      return res.status(400).json({ success: false, message: 'Verification remarks must be at least 10 characters long.' });
    }
    if (trimmedRemarks.length > 500) {
      return res.status(400).json({ success: false, message: 'Verification remarks cannot exceed 500 characters.' });
    }

    const verifier = verified_by || req.user?.name || req.user?.email || 'Accounts Team';

    const checkSql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM workflow_requests WHERE demo_session_id = ? AND id = ?'
      : 'SELECT * FROM workflow_requests WHERE id = ?';
    const checkParams = pool.isDemoMode && sessionId ? [sessionId, requestId] : [requestId];

    const [existing] = await pool.query(checkSql, checkParams);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    const targetReq = existing[0];
    if (Number(targetReq.payment_verified) === 1 || String(targetReq.payment_verification_status).toLowerCase() === 'verified') {
      return res.status(400).json({ success: false, message: 'Payment Already Verified for this request.' });
    }

    if (pool.isDemoMode && sessionId) {
      await pool.query(
        `INSERT INTO payment_verifications (demo_session_id, request_id, verified_by, remarks, status)
         VALUES (?, ?, ?, ?, 'Verified')`,
        [sessionId, requestId, verifier, trimmedRemarks]
      );

      await pool.query(
        `UPDATE workflow_requests
         SET payment_verified = 1,
             payment_verified_by = ?,
             payment_verified_at = NOW(),
             payment_verification_status = 'Verified'
         WHERE demo_session_id = ? AND id = ?`,
        [verifier, sessionId, requestId]
      );

      await pool.query(
        `INSERT INTO request_history (demo_session_id, request_id, action, performed_by)
         VALUES (?, ?, 'Payment Verified', ?)`,
        [sessionId, requestId, verifier]
      ).catch(() => {});

      await pool.query(
        `INSERT INTO notifications (demo_session_id, user_role, request_id, title, message, type)
         VALUES (?, 'accounts', ?, 'Payment Verified', 'Payment verification completed.', 'success')`,
        [sessionId, requestId]
      ).catch(() => {});

      if (targetReq && targetReq.requester_email) {
        await pool.query(
          `INSERT INTO notifications (demo_session_id, user_email, user_role, request_id, title, message, type)
           VALUES (?, ?, 'employee', ?, 'Payment Verified', 'Payment verification completed.', 'success')`,
          [sessionId, targetReq.requester_email, requestId]
        ).catch(() => {});
      }
    } else {
      await pool.query(
        `INSERT INTO payment_verifications (request_id, verified_by, remarks, status)
         VALUES (?, ?, ?, 'Verified')`,
        [requestId, verifier, trimmedRemarks]
      );

      await pool.query(
        `UPDATE workflow_requests
         SET payment_verified = 1,
             payment_verified_by = ?,
             payment_verified_at = NOW(),
             payment_verification_status = 'Verified'
         WHERE id = ?`,
        [verifier, requestId]
      );

      await pool.query(
        `INSERT INTO request_history (request_id, action, performed_by)
         VALUES (?, 'Payment Verified', ?)`,
        [requestId, verifier]
      ).catch(() => {});

      await pool.query(
        `INSERT INTO notifications (user_role, request_id, title, message, type)
         VALUES ('accounts', ?, 'Payment Verified', 'Payment verification completed.', 'success')`,
        [requestId]
      ).catch(() => {});

      if (targetReq && targetReq.requester_email) {
        await pool.query(
          `INSERT INTO notifications (user_email, user_role, request_id, title, message, type)
           VALUES (?, 'employee', ?, 'Payment Verified', 'Payment verification completed.', 'success')`,
          [targetReq.requester_email, requestId]
        ).catch(() => {});
      }
    }

    res.json({
      success: true,
      message: 'Payment Verified Successfully'
    });
  } catch (err) {
    console.error('[AccountsController] Payment Verification POST failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to verify payment: ' + err.message });
  }
};

/**
 * GET /accounts/budget-analysis
 */
exports.getBudgetAnalysis = async (req, res, next) => {
  try {
    const sessionId = getSessionId(req);
    const sql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM workflow_requests WHERE demo_session_id = ? ORDER BY id DESC'
      : 'SELECT * FROM workflow_requests ORDER BY id DESC';
    const params = pool.isDemoMode && sessionId ? [sessionId] : [];

    const [allRows] = await pool.query(sql, params);
    const requests = allRows.map(mapAccountRequestRow);

    const pendingList = requests.filter(r => String(r.status).toLowerCase().includes('pending'));
    const approvedList = requests.filter(r => String(r.status).toLowerCase() === 'approved');

    const totalPending = pendingList.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const totalApproved = approvedList.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const totalSpending = totalApproved + totalPending;

    const largestRequest = requests.reduce((max, r) => Math.max(max, Number(r.amount || 0)), 0);
    const avgRequestAmount = requests.length > 0 ? Math.round(requests.reduce((sum, r) => sum + Number(r.amount || 0), 0) / requests.length) : 0;

    const totalBudgetAllocated = 500000;
    const budgetUsedPercent = Math.min(100, Math.round((totalSpending / totalBudgetAllocated) * 100));
    const budgetRemaining = Math.max(0, totalBudgetAllocated - totalSpending);

    let statusColor = 'Green';
    let statusText = 'Budget Healthy';
    let alertLevel = 'normal';

    if (budgetUsedPercent > 90) {
      statusColor = 'Red';
      statusText = 'Budget Threshold Exceeded';
      alertLevel = 'critical';
    } else if (budgetUsedPercent >= 70) {
      statusColor = 'Yellow';
      statusText = 'Budget Near Limit';
      alertLevel = 'warning';
    }

    const departmentBreakdown = {};
    requests.forEach(r => {
      const dept = r.department || 'Finance';
      if (!departmentBreakdown[dept]) {
        departmentBreakdown[dept] = { pending: 0, approved: 0, total: 0, count: 0 };
      }
      departmentBreakdown[dept].count += 1;
      departmentBreakdown[dept].total += Number(r.amount || 0);
      if (String(r.status).toLowerCase().includes('pending')) {
        departmentBreakdown[dept].pending += Number(r.amount || 0);
      } else if (String(r.status).toLowerCase() === 'approved') {
        departmentBreakdown[dept].approved += Number(r.amount || 0);
      }
    });

    res.json({
      success: true,
      budget: {
        allocated: totalBudgetAllocated,
        used: totalSpending,
        remaining: budgetRemaining,
        usedPercent: budgetUsedPercent,
        statusColor,
        statusText,
        alertLevel
      },
      metrics: {
        totalPending,
        totalApproved,
        totalSpending,
        largestRequest,
        avgRequestAmount,
        totalCount: requests.length,
        pendingCount: pendingList.length,
        approvedCount: approvedList.length
      },
      departments: departmentBreakdown
    });
  } catch (err) {
    console.error('[AccountsController] Budget Analysis failed:', err.message);
    next(err);
  }
};

/**
 * GET /accounts/financial-alerts
 */
exports.getFinancialAlerts = async (req, res, next) => {
  try {
    const sessionId = getSessionId(req);
    const sql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM workflow_requests WHERE demo_session_id = ? ORDER BY id DESC'
      : 'SELECT * FROM workflow_requests ORDER BY id DESC';
    const params = pool.isDemoMode && sessionId ? [sessionId] : [];

    const [rows] = await pool.query(sql, params);
    const requests = rows.map(mapAccountRequestRow);

    const alerts = [];
    const pendingList = requests.filter(r => String(r.status).toLowerCase().includes('pending'));
    const todayStr = new Date().toDateString();

    const rejectedToday = requests.filter(r => {
      const isRejected = String(r.status).toLowerCase() === 'rejected';
      const updatedDate = new Date(Number(r.updatedAt || r.createdAt || Date.now()));
      return isRejected && updatedDate.toDateString() === todayStr;
    }).length;

    pendingList.forEach(r => {
      if (r.amount > 100000 && r.payment_verified !== 1) {
        alerts.push({
          id: `high-val-${r.id}`,
          request_id: r.id,
          type: 'critical',
          title: 'High Value Request',
          text: `High Value Request: Request #${r.id} (${r.title}) amount (₹${r.amount.toLocaleString()}) exceeds ₹100,000`,
          priority: 'High'
        });
      }
    });

    const unverifiedPending = pendingList.filter(r => r.payment_verified !== 1);
    if (unverifiedPending.length > 5) {
      alerts.push({
        id: 'large-queue',
        type: 'warning',
        title: 'Large Pending Queue',
        text: `Large Pending Queue: Currently ${unverifiedPending.length} pending requests awaiting payment verification`,
        priority: 'Medium'
      });
    }

    const totalSpending = requests.reduce((sum, r) => sum + (['pending', 'approved'].some(s => String(r.status).toLowerCase().includes(s)) ? Number(r.amount || 0) : 0), 0);
    const budgetPercent = Math.round((totalSpending / 500000) * 100);
    if (budgetPercent > 90) {
      alerts.push({
        id: 'budget-exceeded',
        type: 'critical',
        title: 'Budget Threshold Exceeded',
        text: `Budget Threshold Exceeded: Overall budget usage is above 90% (${budgetPercent}%)`,
        priority: 'High'
      });
    }

    pendingList.forEach(r => {
      if (String(r.priority).toLowerCase() === 'high' && r.payment_verified !== 1) {
        alerts.push({
          id: `high-prio-${r.id}`,
          request_id: r.id,
          type: 'warning',
          title: 'Immediate Review Required',
          text: `Immediate Review Required: High priority request #${r.id} (${r.title})`,
          priority: 'High'
        });
      }
    });

    const now = Date.now();
    pendingList.forEach(r => {
      const ageHours = (now - Number(r.createdAt || now)) / (1000 * 60 * 60);
      if (ageHours > 48 && r.payment_verified !== 1) {
        alerts.push({
          id: `delay-${r.id}`,
          request_id: r.id,
          type: 'warning',
          title: 'Approval Delay',
          text: `Approval Delay: Request #${r.id} pending for more than 48 hours (${Math.round(ageHours)}h)`,
          priority: 'Medium'
        });
      }
    });

    if (rejectedToday > 3) {
      alerts.push({
        id: 'high-rejection',
        type: 'warning',
        title: 'High Rejection Rate',
        text: `High Rejection Rate: ${rejectedToday} requests rejected today`,
        priority: 'Medium'
      });
    }

    if (alerts.length === 0) {
      alerts.push({
        id: 'no-alerts',
        type: 'info',
        title: 'System Normal',
        text: 'No critical financial alerts.',
        priority: 'Low'
      });
    }

    res.json({ success: true, alerts });
  } catch (err) {
    console.error('[AccountsController] Financial Alerts failed:', err.message);
    next(err);
  }
};

/**
 * GET /accounts/charts
 */
exports.getAnalyticsCharts = async (req, res, next) => {
  try {
    const sessionId = getSessionId(req);
    const sql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM workflow_requests WHERE demo_session_id = ? ORDER BY id ASC'
      : 'SELECT * FROM workflow_requests ORDER BY id ASC';
    const params = pool.isDemoMode && sessionId ? [sessionId] : [];

    const [rows] = await pool.query(sql, params);
    const requests = rows.map(mapAccountRequestRow);

    const departments = ['Finance', 'Sales', 'HR', 'IT', 'Operations', 'Engineering'];
    const departmentAmounts = { Finance: 0, Sales: 0, HR: 0, IT: 0, Operations: 0, Engineering: 0 };
    requests.forEach(r => {
      const dept = departments.includes(r.department) ? r.department : 'Finance';
      departmentAmounts[dept] += Number(r.amount || 0);
    });

    const monthlyExpense = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
      monthlyExpense[label] = 0;
    }

    requests.forEach(r => {
      if (String(r.status).toLowerCase() === 'approved') {
        const d = new Date(Number(r.updatedAt || r.createdAt || Date.now()));
        const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
        if (monthlyExpense.hasOwnProperty(label)) {
          monthlyExpense[label] += Number(r.amount || 0);
        }
      }
    });

    const statusDistribution = { Approved: 0, Pending: 0, Rejected: 0, Cancelled: 0 };
    requests.forEach(r => {
      const s = String(r.status).toLowerCase();
      if (s === 'approved') statusDistribution.Approved += 1;
      else if (s === 'rejected') statusDistribution.Rejected += 1;
      else if (s === 'cancelled') statusDistribution.Cancelled += 1;
      else statusDistribution.Pending += 1;
    });

    res.json({
      success: true,
      departmentChart: {
        labels: Object.keys(departmentAmounts),
        data: Object.values(departmentAmounts)
      },
      monthlyChart: {
        labels: Object.keys(monthlyExpense),
        data: Object.values(monthlyExpense)
      },
      distributionChart: {
        labels: Object.keys(statusDistribution),
        data: Object.values(statusDistribution)
      }
    });
  } catch (err) {
    console.error('[AccountsController] Analytics Charts failed:', err.message);
    next(err);
  }
};

/**
 * GET /accounts/export
 */
exports.getExportData = async (req, res, next) => {
  try {
    const statusFilter = req.query.status || 'ALL';
    const searchQuery = String(req.query.q || '').toLowerCase().trim();
    const sessionId = getSessionId(req);

    const sql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM workflow_requests WHERE demo_session_id = ? ORDER BY id DESC'
      : 'SELECT * FROM workflow_requests ORDER BY id DESC';
    const params = pool.isDemoMode && sessionId ? [sessionId] : [];

    const [rows] = await pool.query(sql, params);
    let requests = rows.map(mapAccountRequestRow);

    if (statusFilter !== 'ALL') {
      requests = requests.filter(r => String(r.status).toLowerCase() === statusFilter.toLowerCase());
    }

    if (searchQuery) {
      requests = requests.filter(r =>
        String(r.id).toLowerCase().includes(searchQuery) ||
        String(r.employee_name).toLowerCase().includes(searchQuery) ||
        String(r.department).toLowerCase().includes(searchQuery) ||
        String(r.title).toLowerCase().includes(searchQuery)
      );
    }

    const exportRows = requests.map(r => ({
      request_id: `#${r.id}`,
      employee: r.employee_name,
      department: r.department,
      amount: r.amount,
      priority: String(r.priority || 'Medium').toUpperCase(),
      status: String(r.status || 'Pending').toUpperCase(),
      current_approver: r.current_approver || r.current_role || 'Accounts',
      created_date: new Date(Number(r.createdAt || Date.now())).toISOString().split('T')[0]
    }));

    res.json({ success: true, data: exportRows });
  } catch (err) {
    console.error('[AccountsController] Export Data failed:', err.message);
    next(err);
  }
};

/**
 * GET /accounts/notifications
 */
exports.getNotifications = async (req, res, next) => {
  try {
    const sessionId = getSessionId(req);
    const sql = pool.isDemoMode && sessionId
      ? `
        SELECT * FROM notifications
        WHERE demo_session_id = ? AND (LOWER(user_role) = 'accounts' OR LOWER(user_role) = 'manager' OR LOWER(user_role) = 'all')
        ORDER BY id DESC LIMIT 25
      `
      : `
        SELECT * FROM notifications
        WHERE LOWER(user_role) = 'accounts' OR LOWER(user_role) = 'manager' OR LOWER(user_role) = 'all'
        ORDER BY id DESC LIMIT 25
      `;
    const params = pool.isDemoMode && sessionId ? [sessionId] : [];

    const [rows] = await pool.query(sql, params).catch(() => [[]]);
    const notificationsList = Array.isArray(rows[0]) ? rows[0] : (Array.isArray(rows) ? rows : []);
    const unreadCount = notificationsList.filter(n => !n.is_read).length;

    res.json({
      success: true,
      unreadCount,
      notifications: notificationsList
    });
  } catch (err) {
    console.error('[AccountsController] Notifications failed:', err.message);
    next(err);
  }
};

/**
 * PUT /accounts/notifications/:id/read
 */
exports.markNotificationRead = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sessionId = getSessionId(req);
    if (id) {
      const sql = pool.isDemoMode && sessionId
        ? 'UPDATE notifications SET is_read = TRUE WHERE demo_session_id = ? AND id = ?'
        : 'UPDATE notifications SET is_read = TRUE WHERE id = ?';
      const params = pool.isDemoMode && sessionId ? [sessionId, id] : [id];
      await pool.query(sql, params).catch(() => {});
    }
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (err) {
    next(err);
  }
};
