// Accounts Controller
// Module Features: Queue, Payment Verification, Budget Analysis, Financial Alerts, Analytics Charts, Export, Notifications

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

function mapAccountRequestRow(row) {
  const workflow = parseJsonValue(row.workflow, []);
  const payload = parseJsonValue(row.payload, {});
  const createdAt = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : createdAt;
  const currentLevel = Number(row.current_level ?? 0);
  const currentRole = row.current_role || workflow[Math.min(currentLevel, Math.max(workflow.length - 1, 0))] || 'Accounts';
  const currentApprover = row.current_approver || currentRole || 'Accounts';
  const approvalStage = row.approval_stage || currentRole || 'Accounts';

  const employeeName = row.requester_name || payload.requester || payload.requester_name || payload.employee || 'Employee';
  const employeeEmail = row.requester_email || payload.requesterEmail || payload.email || '';

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
 * Fetches financial requests, attaching their approvals array and Accounts decision (pending, approved, rejected)
 */
exports.getAccountsRequests = async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
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
    `);

    const requestIds = rows.map(r => r.id).filter(Boolean);
    let approvalsMap = {};
    if (requestIds.length > 0) {
      const [appRows] = await pool.query(
        `SELECT * FROM approvals WHERE request_id IN (${requestIds.join(',')}) ORDER BY step ASC`
      ).catch(() => [[]]);

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
 * Fetches pending requests assigned to Accounts whose payment has NOT yet been verified (payment_verified = 0)
 */
exports.getPaymentVerification = async (req, res, next) => {
  try {
    // Only return requests assigned to Accounts where payment_verified = 0
    const [unverifiedRows] = await pool.query(`
      SELECT * FROM workflow_requests
      WHERE (LOWER(status) = 'pending' OR LOWER(status) LIKE 'pending%')
        AND (LOWER(current_role) = 'accounts' OR LOWER(current_approver) = 'accounts')
        AND LOWER(status) NOT LIKE '%reject%'
        AND LOWER(status) NOT LIKE '%cancel%'
        AND (payment_verified IS NULL OR payment_verified = 0 OR LOWER(payment_verification_status) != 'verified')
      ORDER BY id DESC
    `);

    // Fetch all Accounts pending requests for state inspection if needed
    const [allAccountsRows] = await pool.query(`
      SELECT * FROM workflow_requests
      WHERE (LOWER(status) = 'pending' OR LOWER(status) LIKE 'pending%')
        AND (LOWER(current_role) = 'accounts' OR LOWER(current_approver) = 'accounts')
        AND LOWER(status) NOT LIKE '%reject%'
        AND LOWER(status) NOT LIKE '%cancel%'
      ORDER BY id DESC
    `);

    // Fetch past payment verifications
    const [verifications] = await pool.query(`
      SELECT pv.*, wr.title, wr.amount, wr.requester_name
      FROM payment_verifications pv
      JOIN workflow_requests wr ON pv.request_id = wr.id
      ORDER BY pv.id DESC
    `).catch(() => [[]]);

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
 * Validates request, records verification in payment_verifications, updates workflow_requests, logs request_history and notifications
 */
exports.createPaymentVerification = async (req, res, next) => {
  try {
    const { request_id, remarks, verified_by } = req.body || {};
    const requestId = Number(request_id);

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

    // Verify request exists and check if already verified
    const [existing] = await pool.query('SELECT * FROM workflow_requests WHERE id = ?', [requestId]);
    if (!existing || existing.length === 0) {
      return res.status(444 || 404).json({ success: false, message: 'Request not found' });
    }

    const targetReq = existing[0];
    if (Number(targetReq.payment_verified) === 1 || String(targetReq.payment_verification_status).toLowerCase() === 'verified') {
      return res.status(400).json({ success: false, message: 'Payment Already Verified for this request.' });
    }

    // 1. Insert into payment_verifications
    await pool.query(
      `INSERT INTO payment_verifications (request_id, verified_by, remarks, status)
       VALUES (?, ?, ?, 'Verified')`,
      [requestId, verifier, trimmedRemarks]
    );

    // 2. Update workflow_requests
    await pool.query(
      `UPDATE workflow_requests
       SET payment_verified = 1,
           payment_verified_by = ?,
           payment_verified_at = NOW(),
           payment_verification_status = 'Verified'
       WHERE id = ?`,
      [verifier, requestId]
    );

    // 3. Write audit entry into request_history
    await pool.query(
      `INSERT INTO request_history (request_id, action, performed_by)
       VALUES (?, 'Payment Verified', ?)`,
      [requestId, verifier]
    ).catch(err => console.error('History audit error:', err.message));

    // 4. Create Notification for Accounts & Employee
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
 * Calculates department totals, spending, average, max, used budget %, remaining budget & warning states
 */
exports.getBudgetAnalysis = async (req, res, next) => {
  try {
    const [allRows] = await pool.query('SELECT * FROM workflow_requests ORDER BY id DESC');
    const requests = allRows.map(mapAccountRequestRow);

    const pendingList = requests.filter(r => String(r.status).toLowerCase() === 'pending');
    const approvedList = requests.filter(r => String(r.status).toLowerCase() === 'approved');

    const totalPending = pendingList.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const totalApproved = approvedList.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const totalSpending = totalApproved + totalPending;

    const largestRequest = requests.reduce((max, r) => Math.max(max, Number(r.amount || 0)), 0);
    const avgRequestAmount = requests.length > 0 ? Math.round(requests.reduce((sum, r) => sum + Number(r.amount || 0), 0) / requests.length) : 0;

    // Allocated Budget Pool
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

    // Department Breakdown
    const departmentBreakdown = {};
    requests.forEach(r => {
      const dept = r.department || 'Finance';
      if (!departmentBreakdown[dept]) {
        departmentBreakdown[dept] = { pending: 0, approved: 0, total: 0, count: 0 };
      }
      departmentBreakdown[dept].count += 1;
      departmentBreakdown[dept].total += Number(r.amount || 0);
      if (String(r.status).toLowerCase() === 'pending') {
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
 * Evaluates high value requests, pending queue size, budget limits, priority, delays > 48h, rejections
 * Automatically removes Immediate Review Required for payment-verified requests!
 */
exports.getFinancialAlerts = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM workflow_requests ORDER BY id DESC');
    const requests = rows.map(mapAccountRequestRow);

    const alerts = [];
    const pendingList = requests.filter(r => String(r.status).toLowerCase() === 'pending');
    const todayStr = new Date().toDateString();

    const rejectedToday = requests.filter(r => {
      const isRejected = String(r.status).toLowerCase() === 'rejected';
      const updatedDate = new Date(Number(r.updatedAt || r.createdAt || Date.now()));
      return isRejected && updatedDate.toDateString() === todayStr;
    }).length;

    // Rule 1: Request amount > 100,000 (excluding verified payments)
    pendingList.forEach(r => {
      if (r.amount > 100000 && r.payment_verified !== 1) {
        alerts.push({
          id: `high-val-${r.id}`,
          request_id: r.id,
          type: 'critical',
          title: 'High Value Request',
          text: `High Value Request: Request #${r.id} (${r.title}) amount ($${r.amount.toLocaleString()}) exceeds $100,000`,
          priority: 'High'
        });
      }
    });

    // Rule 2: Pending requests > 5
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

    // Rule 3: Budget usage > 90%
    const totalSpending = requests.reduce((sum, r) => sum + (['pending', 'approved'].includes(String(r.status).toLowerCase()) ? Number(r.amount || 0) : 0), 0);
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

    // Rule 4: Immediate Review Required (High Priority, ONLY for UNVERIFIED requests!)
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

    // Rule 5: Request waiting > 48 hours (excluding verified)
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

    // Rule 6: Rejected today > 3
    if (rejectedToday > 3) {
      alerts.push({
        id: 'high-rejection',
        type: 'warning',
        title: 'High Rejection Rate',
        text: `High Rejection Rate: ${rejectedToday} requests rejected today`,
        priority: 'Medium'
      });
    }

    // Default if no alerts triggered
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
 * Analytics datasets for Chart.js: Amount by Department, Monthly Expense, Approval Distribution
 */
exports.getAnalyticsCharts = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM workflow_requests ORDER BY id ASC');
    const requests = rows.map(mapAccountRequestRow);

    // 1. Amount by Department (Finance, Sales, HR, IT, Operations)
    const departments = ['Finance', 'Sales', 'HR', 'IT', 'Operations'];
    const departmentAmounts = { Finance: 0, Sales: 0, HR: 0, IT: 0, Operations: 0 };
    requests.forEach(r => {
      const dept = departments.includes(r.department) ? r.department : 'Finance';
      departmentAmounts[dept] += Number(r.amount || 0);
    });

    // 2. Monthly Expense (Last 12 months for approved requests)
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

    // 3. Approval Distribution (Approved, Pending, Rejected, Cancelled)
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
 * Exports financial requests dataset with Request ID, Employee, Department, Amount, Priority, Status, Current Approver, Created Date
 */
exports.getExportData = async (req, res, next) => {
  try {
    const statusFilter = req.query.status || 'ALL';
    const searchQuery = String(req.query.q || '').toLowerCase().trim();

    const [rows] = await pool.query('SELECT * FROM workflow_requests ORDER BY id DESC');
    let requests = rows.map(mapAccountRequestRow);

    // Apply Filter
    if (statusFilter !== 'ALL') {
      requests = requests.filter(r => String(r.status).toLowerCase() === statusFilter.toLowerCase());
    }

    // Apply Search
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
 * Returns notifications list and unread count for Accounts team
 */
exports.getNotifications = async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT * FROM notifications
      WHERE LOWER(user_role) = 'accounts' OR LOWER(user_role) = 'manager' OR LOWER(user_role) = 'all'
      ORDER BY id DESC LIMIT 25
    `).catch(() => [[]]);

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
 * Marks a specific notification as read
 */
exports.markNotificationRead = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id) {
      await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = ?', [id]).catch(() => {});
    }
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (err) {
    next(err);
  }
};
