/**
 * ZyroFlow Accounts Dashboard Client Logic
 * Handles Queue, Payment Verification, Budget Analysis, Financial Alerts, Analytics Charts, Export, and Notifications
 */

let accountsRequestsCache = [];
let currentFilter = 'Pending';
let chartInstances = {};

// Reuses global API_BASE from app.js (e.g. http://localhost:4000/api)

// Utility helper to get authorization token
function getAuthToken() {
  return localStorage.getItem('authToken') || localStorage.getItem('auth_token') || '';
}

// Utility helper to format numbers into INR currency format
function formatCurrency(val) {
  const num = Number(val || 0);
  return '₹' + num.toLocaleString('en-IN');
}

// Utility helper to HTML escape strings to prevent XSS
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Normalize status string
function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

// Map status to clean display label
function toStatusLabel(status) {
  const s = normalizeStatus(status);
  if (s === 'approved') return 'Approved';
  if (s === 'rejected') return 'Rejected';
  if (s === 'cancelled') return 'Cancelled';
  if (s === 'in_progress') return 'In Progress';
  return 'Pending';
}

// Toast notification helper
function showToast(message, type = 'success', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icon = type === 'success' ? '✓' : (type === 'error' ? '✕' : 'ℹ');
  toast.innerHTML = `<span class="toast-icon">${icon}</span> <span class="toast-text">${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// Initialize Dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  checkAuthentication();
  displayUserHeader();
  updateDashboardMetrics(accountsRequestsCache);
  loadAccountsRequests();
  loadFinancialAlerts();
  loadAnalyticsCharts();
  loadNotifications();

  // Auto-refresh financial alerts every 30 seconds
  setInterval(() => {
    loadFinancialAlerts();
  }, 30000);
});

// Global Keyboard (ESC) and Overlay Backdrop Click Listeners for Modal Close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'Esc') {
    closeModal();
  }
});

document.addEventListener('click', (e) => {
  const overlay = document.getElementById('dashboard-modal');
  if (overlay && overlay.classList.contains('open') && e.target === overlay) {
    closeModal();
  }
});

// Verify login and role authorization
function checkAuthentication() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  const token = getAuthToken();
  const role = (currentUser && currentUser.role) || localStorage.getItem('role') || localStorage.getItem('userRole') || '';

  if (!token && !currentUser) {
    window.location.href = 'login.html';
    return;
  }

  const normalizedRole = String(role).toLowerCase().trim();
  if (normalizedRole !== 'accounts' && normalizedRole !== 'admin') {
    window.location.href = 'login.html';
    return;
  }
}

// Display welcome header info
function displayUserHeader() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  const displayName = currentUser && currentUser.name ? currentUser.name : 'Accounts Team';

  const welcomeText = document.getElementById('welcomeText');
  const heroHeading = document.getElementById('heroHeading');
  const approverTitle = document.getElementById('approver-title');

  if (welcomeText) welcomeText.textContent = `Good Morning, ${displayName}`;
  if (heroHeading) heroHeading.textContent = `Good Morning, ${displayName}`;
  if (approverTitle) approverTitle.textContent = `Accounts Dashboard`;
}

// Fetch financial requests assigned to Accounts from backend
async function loadAccountsRequests() {
  const requestsList = document.getElementById('requests-list');

  if (requestsList) {
    requestsList.innerHTML = '<tr class="empty-state"><td colspan="7"><div class="spinner"></div> Loading financial request queue...</td></tr>';
  }

  try {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE}/accounts/requests`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to fetch financial requests from server');
    }

    const data = await response.json();
    accountsRequestsCache = Array.isArray(data) ? data : [];
    if (window.ZyroWorkflow) {
      ZyroWorkflow.renderFilterToolbar('zyro-filter-container', {
        data: accountsRequestsCache,
        renderTable: (filtered) => renderAccountsQueue(filtered),
        updateMetrics: (filtered) => updateDashboardMetrics(filtered)
      });
    }
    renderAccountsQueue();
  } catch (err) {
    console.error('[AccountsDashboard] Error loading requests:', err.message);
    if (requestsList) {
      requestsList.innerHTML = '<tr class="empty-state"><td colspan="7">Failed to load requests. Please refresh or try logging in again.</td></tr>';
    }
    updateDashboardMetrics(accountsRequestsCache);
  }
}

// Determine Accounts approval decision for a request (Source of Truth)
function getAccountsDecision(req) {
  if (!req) return 'pending';

  // 1. Check approvals array step for Accounts (Highest precision)
  const approvalsList = Array.isArray(req.approvals) ? req.approvals : [];
  const accStep = approvalsList.find(a => String(a.approver_role || a.role || '').toLowerCase().trim() === 'accounts');
  if (accStep && accStep.status) {
    const st = String(accStep.status).toLowerCase().trim();
    if (st === 'approved') return 'approved';
    if (st === 'rejected') return 'rejected';
    if (st === 'pending') return 'pending';
  }

  // 2. Check approval_history for Accounts decision
  const historyList = Array.isArray(req.approval_history) ? req.approval_history : (Array.isArray(req.history) ? req.history : []);
  const accHist = historyList.filter(h => String(h.approval_stage || h.stage || h.role || '').toLowerCase().trim() === 'accounts');
  if (accHist.length > 0) {
    const lastAcc = accHist[accHist.length - 1];
    const decision = String(lastAcc.decision || lastAcc.action || '').toLowerCase().trim();
    if (decision.includes('approve')) return 'approved';
    if (decision.includes('reject')) return 'rejected';
  }

  // 3. Check direct accounts_approval_status or accounts_history_decision from API
  if (req.accounts_approval_status) {
    const st = String(req.accounts_approval_status).toLowerCase().trim();
    if (['approved', 'rejected', 'pending'].includes(st)) return st;
  }
  if (req.accounts_history_decision) {
    const dec = String(req.accounts_history_decision).toLowerCase().trim();
    if (dec.includes('approve')) return 'approved';
    if (dec.includes('reject')) return 'rejected';
  }

  // 4. Check explicit accounts_decision from DB query
  if (req.accounts_decision) {
    const dec = String(req.accounts_decision).toLowerCase().trim();
    if (['approved', 'rejected', 'pending'].includes(dec)) return dec;
  }

  return 'pending';
}

// Get decision timestamp for Accounts decision (for Approved/Rejected date range filtering)
function getAccountsDecisionDate(req, targetStatus) {
  if (!req) return null;
  const statusLower = String(targetStatus || '').toLowerCase().trim();

  if (statusLower === 'approved') {
    const historyList = Array.isArray(req.approval_history) ? req.approval_history : (Array.isArray(req.history) ? req.history : []);
    const accApproveEntry = historyList.find(h => 
      String(h.approval_stage || h.stage || h.role || '').toLowerCase().trim() === 'accounts' &&
      String(h.decision || h.action || '').toLowerCase().includes('approve')
    );
    if (accApproveEntry) {
      const dt = accApproveEntry.decision_timestamp || accApproveEntry.timestamp || accApproveEntry.created_at;
      if (dt) return dt;
    }

    const approvalsList = Array.isArray(req.approvals) ? req.approvals : [];
    const accStep = approvalsList.find(a => String(a.approver_role || a.role || '').toLowerCase().trim() === 'accounts');
    if (accStep && accStep.updated_at) return accStep.updated_at;

    return req.updated_at || req.updatedAt || req.created_at || req.createdAt;
  }

  if (statusLower === 'rejected') {
    const historyList = Array.isArray(req.approval_history) ? req.approval_history : (Array.isArray(req.history) ? req.history : []);
    const accRejectEntry = historyList.find(h => 
      String(h.approval_stage || h.stage || h.role || '').toLowerCase().trim() === 'accounts' &&
      String(h.decision || h.action || '').toLowerCase().includes('reject')
    );
    if (accRejectEntry) {
      const dt = accRejectEntry.decision_timestamp || accRejectEntry.timestamp || accRejectEntry.created_at;
      if (dt) return dt;
    }

    const approvalsList = Array.isArray(req.approvals) ? req.approvals : [];
    const accStep = approvalsList.find(a => String(a.approver_role || a.role || '').toLowerCase().trim() === 'accounts');
    if (accStep && accStep.updated_at) return accStep.updated_at;

    return req.updated_at || req.updatedAt || req.created_at || req.createdAt;
  }

  return null;
}

// Filter requests by status buttons (Pending, Approved, Rejected)
function filterRequests(status) {
  currentFilter = status;
  updateActiveFilterButtons();
  renderAccountsQueue();
}

// Update filter button CSS classes
function updateActiveFilterButtons() {
  const buttons = document.querySelectorAll('.filter-button');
  buttons.forEach((btn) => {
    const filterVal = btn.dataset.filter || btn.textContent.trim();
    if (filterVal.toLowerCase() === String(currentFilter || 'Pending').toLowerCase()) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// Search matching logic
function matchesSearchQuery(req, query) {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  const idStr = String(req.id || '').toLowerCase();
  const employeeStr = String(req.employee_name || req.requester_name || req.employee || req.requester || '').toLowerCase();
  const deptStr = String(req.department || '').toLowerCase();
  const typeStr = String(req.request_type || req.type || req.title || '').toLowerCase();

  return idStr.includes(q) || employeeStr.includes(q) || deptStr.includes(q) || typeStr.includes(q);
}

// Render financial request table and update summary metrics
function renderAccountsQueue(customList) {
  const requestsList = document.getElementById('requests-list');
  if (!requestsList) return;

  let finalRequests = customList;
  if (!finalRequests) {
    const searchInput = document.getElementById('searchBox');
    const searchQuery = searchInput ? searchInput.value : '';

    const filterUpper = String(currentFilter || 'PENDING').trim().toUpperCase();
    const statusFiltered = accountsRequestsCache.filter((r) => {
      const dec = getAccountsDecision(r).toUpperCase();
      if (filterUpper === 'PENDING') return dec === 'PENDING';
      if (filterUpper === 'APPROVED') return dec === 'APPROVED';
      if (filterUpper === 'REJECTED') return dec === 'REJECTED';
      return dec === filterUpper;
    });

    finalRequests = statusFiltered.filter((r) => matchesSearchQuery(r, searchQuery));
  }

  if (!finalRequests || finalRequests.length === 0) {
    requestsList.innerHTML = '<tr class="empty-state"><td colspan="7">No requests match current filter/search.</td></tr>';
    updateDashboardMetrics(accountsRequestsCache);
    return;
  }

  requestsList.innerHTML = finalRequests.map((req) => {
    const reqId = req.id != null ? req.id : '—';
    const employeeName = escapeHtml(req.employee_name || req.requester_name || req.employee || req.requester || 'Employee');
    const department = escapeHtml(req.department || 'Finance');
    const requestType = escapeHtml(req.request_type || req.type || req.title || 'Financial Request');
    const amountFormatted = formatCurrency(req.amount);
    
    const accDecision = getAccountsDecision(req);
    const statusNormalized = accDecision;
    const statusLabel = accDecision.charAt(0).toUpperCase() + accDecision.slice(1);

    const isVerified = Number(req.payment_verified ?? 0) === 1 || String(req.payment_verification_status).toLowerCase() === 'verified';
    const pvBadge = isVerified
      ? `<span class="pv-badge pv-badge-verified" style="display:inline-block; margin-left:6px; background:#10b981; color:#ffffff; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:600;">Payment Verified</span>`
      : `<span class="pv-badge pv-badge-pending" style="display:inline-block; margin-left:6px; background:#f59e0b; color:#ffffff; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:600;">Payment Verification Pending</span>`;

    const btnCommonStyle = "display:inline-flex; align-items:center; justify-content:center; height:30px; padding:0 12px; border-radius:6px; font-weight:600; font-size:12px; vertical-align:middle;";

    let actionButtonsHtml = '';
    if (accDecision === 'pending') {
      if (isVerified) {
        actionButtonsHtml = `
          <button class="action-btn approve-btn" style="${btnCommonStyle} background:#10b981; color:#ffffff; border:none; cursor:pointer; margin-right:4px;" onclick="ZyroWorkflow.openDecisionModal('approve', '${reqId}', () => loadAccountsRequests())">Approve</button>
          <button class="action-btn reject-btn" style="${btnCommonStyle} background:#ef4444; color:#ffffff; border:none; cursor:pointer; margin-right:4px;" onclick="ZyroWorkflow.openDecisionModal('reject', '${reqId}', () => loadAccountsRequests())">Reject</button>
          <button class="details-button" style="${btnCommonStyle}" onclick="ZyroWorkflow.showRequestDetails('${reqId}')">Details</button>
        `;
      } else {
        actionButtonsHtml = `
          <button class="action-btn approve-btn disabled" style="${btnCommonStyle} background:#94a3b8; color:#ffffff; border:none; cursor:not-allowed; opacity:0.6; margin-right:4px;" disabled title="Complete payment verification first.">Approve</button>
          <button class="action-btn reject-btn disabled" style="${btnCommonStyle} background:#94a3b8; color:#ffffff; border:none; cursor:not-allowed; opacity:0.6; margin-right:4px;" disabled title="Complete payment verification first.">Reject</button>
          <button class="details-button" style="${btnCommonStyle}" onclick="ZyroWorkflow.showRequestDetails('${reqId}')">Details</button>
        `;
      }
    } else if (accDecision === 'approved') {
      actionButtonsHtml = `
        <span class="decision-badge" style="display:inline-flex; align-items:center; justify-content:center; height:30px; padding:0 10px; background:rgba(16,185,129,0.15); color:#10b981; border-radius:6px; font-size:12px; font-weight:600; margin-right:6px; vertical-align:middle;">Approved</span>
        <button class="details-button" style="${btnCommonStyle}" onclick="ZyroWorkflow.showRequestDetails('${reqId}')">Details</button>
      `;
    } else {
      actionButtonsHtml = `
        <span class="decision-badge" style="display:inline-flex; align-items:center; justify-content:center; height:30px; padding:0 10px; background:rgba(239,68,68,0.15); color:#ef4444; border-radius:6px; font-size:12px; font-weight:600; margin-right:6px; vertical-align:middle;">Rejected</span>
        <button class="details-button" style="${btnCommonStyle}" onclick="ZyroWorkflow.showRequestDetails('${reqId}')">Details</button>
      `;
    }

    return `
      <tr class="queue-row" style="cursor:pointer;" onclick="if (!event.target.closest('button')) ZyroWorkflow.showRequestDetails('${reqId}')">
        <td>#${escapeHtml(String(reqId))}</td>
        <td>${employeeName}</td>
        <td>${department}</td>
        <td>${requestType}</td>
        <td><strong>${amountFormatted}</strong></td>
        <td>
          <span class="status-pill status-${statusNormalized}">${statusLabel}</span>
          ${pvBadge}
        </td>
        <td style="white-space:nowrap;">
          ${actionButtonsHtml}
        </td>
      </tr>
    `;
  }).join('');

  updateDashboardMetrics(finalRequests);
}

// Navigation to Review page
function navigateToReview(requestId) {
  if (!requestId) return;
  window.location.href = `review-request.html?id=${encodeURIComponent(requestId)}`;
}

// Update KPI Metrics Cards
function updateDashboardMetrics(requests) {
  const pendingList = requests.filter(r => getAccountsDecision(r) === 'pending');
  const approvedList = requests.filter(r => getAccountsDecision(r) === 'approved');
  const rejectedList = requests.filter(r => getAccountsDecision(r) === 'rejected');

  const pendingCount = pendingList.length;
  const processedCount = approvedList.length + rejectedList.length;

  const reviewAmount = pendingList.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const approvedAmount = approvedList.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const rejectedAmount = rejectedList.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText('pending-count', pendingCount);
  setText('processed-count', processedCount);
  setText('review-amount', formatCurrency(reviewAmount));
  setText('approved-amount', formatCurrency(approvedAmount));
  setText('rejected-amount', formatCurrency(rejectedAmount));
  setText('pending-summary', pendingCount);
  setText('processed-summary', processedCount);
  setText('review-summary', pendingCount);
  setText('insight-today', requests.length);
  setText('insight-pending', pendingCount);
  setText('insight-under-review', formatCurrency(reviewAmount));

  if (document.getElementById('insight-largest')) {
    const largestVal = requests.reduce((max, r) => Math.max(max, Number(r.amount || 0)), 0);
    setText('insight-largest', formatCurrency(largestVal));
  }
}

// Scroll to Financial Queue
function scrollToQueue() {
  const queueSec = document.getElementById('queue-section');
  if (queueSec) {
    queueSec.scrollIntoView({ behavior: 'smooth' });
  }
}

/**
 * Reusable Dashboard Modal Controller
 * - Header & Footer remain fixed
 * - Body scrolls independently
 * - Prevents background scrolling when active
 */
function openModal(title, bodyHtml, footerHtml = '') {
  const overlay = document.getElementById('dashboard-modal');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const footerEl = document.getElementById('modal-footer');
  
  if (!overlay || !titleEl || !bodyEl) return;
  titleEl.textContent = title;
  bodyEl.innerHTML = bodyHtml;

  if (footerEl) {
    if (footerHtml) {
      footerEl.innerHTML = footerHtml;
      footerEl.style.display = 'flex';
    } else {
      footerEl.innerHTML = '<button class="action-button secondary" onclick="closeModal()">Close</button>';
      footerEl.style.display = 'flex';
    }
  }

  overlay.classList.add('open');
  document.body.style.overflow = "hidden";
}

function closeModal() {
  const overlay = document.getElementById('dashboard-modal');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = "auto";
}

/* ==================================================
 * 1. PAYMENT VERIFICATION MODULE
 * ================================================== */
let pvPendingRequests = [];
let pvSelectedRequest = null;

// Unified eligibility filter for Payment Verification selector
function getEligiblePaymentVerificationRequests(candidatePool) {
  const list = Array.isArray(candidatePool) ? candidatePool : [];
  return list.filter(r => {
    if (!r) return false;
    const isVerified = Number(r.payment_verified ?? 0) === 1 || String(r.payment_verification_status || '').toLowerCase() === 'verified';
    const normStatus = normalizeStatus(r.status);
    const isPendingStatus = normStatus.startsWith('pending') || normStatus === 'submitted' || normStatus === 'waiting' || normStatus === 'in_review';
    const isNotClosed = !normStatus.includes('reject') && !normStatus.includes('cancel') && normStatus !== 'approved' && normStatus !== 'completed';
    const role = String(r.current_role || r.currentRole || r.current_approver || r.currentApprover || '').toLowerCase().trim();
    const isAtAccounts = role === 'accounts' || role === '';

    return !isVerified && isPendingStatus && isNotClosed && isAtAccounts;
  });
}

async function openVerificationModal() {
  openModal(
    'Payment Verification',
    '<div class="spinner"></div> Loading payment verification data...',
    '<button class="action-button secondary" onclick="closeModal()">Close</button>'
  );

  try {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/accounts/payment-verification`, {
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    }).catch(() => null);

    let apiPending = [];
    if (res && res.ok) {
      const data = await res.json();
      apiPending = Array.isArray(data.pending) ? data.pending : [];
    }

    // Merge API response with accountsRequestsCache to guarantee complete parity with the Financial Request Queue
    const combinedMap = new Map();
    [...apiPending, ...(accountsRequestsCache || [])].forEach(r => {
      if (r && r.id != null && !combinedMap.has(Number(r.id))) {
        combinedMap.set(Number(r.id), r);
      }
    });

    // Dynamically derive all eligible pending Accounts requests requiring payment verification
    pvPendingRequests = getEligiblePaymentVerificationRequests(Array.from(combinedMap.values()));

    if (pvPendingRequests.length === 0) {
      openModal(
        'Payment Verification',
        '<p class="modal-intro">No pending requests assigned to Accounts require payment verification at this time.</p>',
        '<button class="action-button secondary" onclick="closeModal()">Close</button>'
      );
      return;
    }

    renderPaymentVerificationModal(pvPendingRequests[0].id);
  } catch (err) {
    openModal(
      'Payment Verification',
      `<div class="error-box">Error loading data: ${escapeHtml(err.message)}</div>`,
      '<button class="action-button secondary" onclick="closeModal()">Close</button>'
    );
  }
}

let isPvRemarksUserEdited = false;

function renderPaymentVerificationModal(selectedId) {
  pvSelectedRequest = pvPendingRequests.find(r => Number(r.id) === Number(selectedId)) || pvPendingRequests[0];

  if (!pvSelectedRequest) return;
  isPvRemarksUserEdited = false;

  const selectOptions = pvPendingRequests.map(r => {
    const isSel = Number(r.id) === Number(pvSelectedRequest.id) ? 'selected' : '';
    const statusLabel = toStatusLabel(r.status);
    return `
      <option value="${r.id}" ${isSel}>
        #${r.id} | ${escapeHtml(r.employee_name)} | ${escapeHtml(r.department)} | ${formatCurrency(r.amount)} | ${statusLabel}
      </option>
    `;
  }).join('');

  const isVerified = Number(pvSelectedRequest.payment_verified) === 1 || String(pvSelectedRequest.payment_verification_status).toLowerCase() === 'verified';
  const createdDateStr = new Date(Number(pvSelectedRequest.createdAt || Date.now())).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  const bodyHtml = `
    <div class="pv-container">
      ${isVerified ? '<div class="pv-status-verified" style="background:#10b981; color:#fff; padding:8px 12px; border-radius:6px; font-weight:600; margin-bottom:12px; display:inline-block;">Payment Verified</div>' : ''}

      <div class="pv-select-group">
        <label class="pv-label">Select Request for Verification:</label>
        <select id="pv-request-select" class="pv-select" onchange="onPaymentVerificationSelectChange(this.value)">
          ${selectOptions}
        </select>
      </div>

      <div class="pv-details-grid">
        <div class="pv-detail-item"><span class="pv-detail-label">Employee</span><strong class="pv-detail-val">${escapeHtml(pvSelectedRequest.employee_name)}</strong></div>
        <div class="pv-detail-item"><span class="pv-detail-label">Department</span><strong class="pv-detail-val">${escapeHtml(pvSelectedRequest.department)}</strong></div>
        <div class="pv-detail-item"><span class="pv-detail-label">Amount</span><strong class="pv-detail-val highlight">${formatCurrency(pvSelectedRequest.amount)}</strong></div>
        <div class="pv-detail-item"><span class="pv-detail-label">Vendor</span><strong class="pv-detail-val">${escapeHtml(pvSelectedRequest.vendor_name || 'Verified Corporate Vendor')}</strong></div>
        <div class="pv-detail-item"><span class="pv-detail-label">Purchase Order</span><strong class="pv-detail-val">${escapeHtml(pvSelectedRequest.po_number || `PO-2026-0${pvSelectedRequest.id}`)}</strong></div>
        <div class="pv-detail-item"><span class="pv-detail-label">Invoice</span><strong class="pv-detail-val">${escapeHtml(pvSelectedRequest.invoice_number || `INV-2026-0${pvSelectedRequest.id}`)}</strong></div>
        <div class="pv-detail-item"><span class="pv-detail-label">Budget Status</span><strong class="pv-detail-val">Budget Available</strong></div>
        <div class="pv-detail-item"><span class="pv-detail-label">Current Workflow</span><strong class="pv-detail-val">${escapeHtml(pvSelectedRequest.current_approver || pvSelectedRequest.current_role || 'Accounts')}</strong></div>
      </div>

      <div class="pv-checklist-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
          <div>
            <h4 class="pv-checklist-title">Checklist</h4>
            <p class="pv-checklist-sub">All compliance checks must be verified before payment authorization.</p>
          </div>
          <span id="pv-progress-badge" class="pv-progress-badge">0/5 Completed</span>
        </div>

        <div class="pv-checklist">
          <label class="pv-check-item" style="border-bottom: 1px solid rgba(255,255,255,0.12); margin-bottom: 8px; padding-bottom: 8px; font-weight: 700;">
            <input type="checkbox" id="pv-select-all" ${isVerified ? 'disabled checked' : ''} onchange="togglePvSelectAll()" />
            <span>Select All</span>
          </label>
          <label class="pv-check-item">
            <input type="checkbox" class="pv-chk" ${isVerified ? 'disabled checked' : ''} onchange="onPvChecklistChange()" />
            <span>Purchase Order Verified</span>
          </label>
          <label class="pv-check-item">
            <input type="checkbox" class="pv-chk" ${isVerified ? 'disabled checked' : ''} onchange="onPvChecklistChange()" />
            <span>Invoice Verified</span>
          </label>
          <label class="pv-check-item">
            <input type="checkbox" class="pv-chk" ${isVerified ? 'disabled checked' : ''} onchange="onPvChecklistChange()" />
            <span>Vendor Verified</span>
          </label>
          <label class="pv-check-item">
            <input type="checkbox" class="pv-chk" ${isVerified ? 'disabled checked' : ''} onchange="onPvChecklistChange()" />
            <span>Budget Available</span>
          </label>
          <label class="pv-check-item">
            <input type="checkbox" class="pv-chk" ${isVerified ? 'disabled checked' : ''} onchange="onPvChecklistChange()" />
            <span>Amount Verified</span>
          </label>
        </div>
      </div>

      <div class="pv-remarks-group">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <label class="pv-label">Remarks:</label>
          <span id="pv-char-count" class="pv-char-counter">0 / 500 characters</span>
        </div>
        <textarea id="pv-remarks" class="pv-textarea" ${isVerified ? 'disabled' : ''} placeholder="Enter verification remarks..." oninput="onPvRemarksInput()">${isVerified ? escapeHtml(pvSelectedRequest.remarks || 'Payment Verified') : ''}</textarea>
      </div>
    </div>
  `;

  const footerHtml = `
    <button class="action-button secondary" onclick="closeModal()">Close</button>
    <button id="pv-verify-btn" class="action-button primary" ${isVerified ? 'disabled' : ''} onclick="submitPaymentVerification()">Verify Payment</button>
  `;

  openModal(`Payment Verification - Request #${pvSelectedRequest.id}`, bodyHtml, footerHtml);
  onPvChecklistChange();
}

function onPaymentVerificationSelectChange(id) {
  renderPaymentVerificationModal(id);
}

function togglePvSelectAll() {
  const selectAll = document.getElementById('pv-select-all');
  if (!selectAll) return;
  const checkable = Array.from(document.querySelectorAll('.pv-chk'));
  checkable.forEach(c => {
    if (!c.disabled) {
      c.checked = selectAll.checked;
    }
  });
  onPvChecklistChange();
}

function onPvRemarksInput() {
  isPvRemarksUserEdited = true;
  const remarksEl = document.getElementById('pv-remarks');
  const counterEl = document.getElementById('pv-char-count');
  if (!remarksEl || !counterEl) return;

  const len = remarksEl.value.trim().length;
  counterEl.textContent = `${len} / 500 characters`;
  onPvChecklistChange();
}

function onPvChecklistChange() {
  const checkable = Array.from(document.querySelectorAll('.pv-chk'));
  const checkedCount = checkable.filter(c => c.checked).length;
  const selectAll = document.getElementById('pv-select-all');

  // Reverse synchronization for Select All
  if (selectAll && !selectAll.disabled) {
    selectAll.checked = (checkedCount === 5);
  }

  const badge = document.getElementById('pv-progress-badge');
  if (badge) {
    if (checkedCount === 5) {
      badge.className = 'pv-progress-badge ready';
      badge.textContent = 'Ready for Verification';
    } else {
      badge.className = 'pv-progress-badge';
      badge.textContent = `${checkedCount}/5 Completed`;
    }
  }

  const remarksEl = document.getElementById('pv-remarks');
  const DEFAULT_REMARKS = 'All payment verification checks have been completed and verified.';
  const isVerified = pvSelectedRequest && (Number(pvSelectedRequest.payment_verified) === 1 || String(pvSelectedRequest.payment_verification_status).toLowerCase() === 'verified');

  if (checkedCount === 5 && remarksEl && !isVerified) {
    if (!isPvRemarksUserEdited || !remarksEl.value.trim()) {
      remarksEl.value = DEFAULT_REMARKS;
      const counterEl = document.getElementById('pv-char-count');
      if (counterEl) counterEl.textContent = `${DEFAULT_REMARKS.length} / 500 characters`;
    }
  }

  const remarksLen = remarksEl ? remarksEl.value.trim().length : 0;
  const btn = document.getElementById('pv-verify-btn');

  if (btn) {
    btn.disabled = isVerified || checkedCount !== 5 || remarksLen < 1;
  }
}

async function submitPaymentVerification() {
  if (!pvSelectedRequest) return;
  const remarksEl = document.getElementById('pv-remarks');
  const remarks = remarksEl ? remarksEl.value.trim() : '';

  const checkable = Array.from(document.querySelectorAll('.pv-chk'));
  const checkedCount = checkable.filter(c => c.checked).length;

  if (checkedCount < 5 || !remarks) {
    showToast('Complete all verification checks.', 'error');
    return;
  }

  const btn = document.getElementById('pv-verify-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Verifying...';
  }

  try {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/accounts/payment-verification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({
        request_id: pvSelectedRequest.id,
        remarks: remarks,
        verified_by: 'Accounts Team'
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to submit payment verification');
    }

    showToast('Payment Verified Successfully', 'success');

    // Auto-refresh all dashboard data dynamically without page reload!
    loadAccountsRequests();
    loadFinancialAlerts();
    loadAnalyticsCharts();
    loadNotifications();

    // Close modal after 2 seconds
    setTimeout(() => {
      closeModal();
    }, 2000);
  } catch (err) {
    showToast(`Verification Failed: ${err.message}`, 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Verify Payment';
    }
  }
}

/* ==================================================
 * 2. BUDGET ANALYSIS MODULE
 * ================================================== */
async function openBudgetModal() {
  openModal(
    'Budget Analysis',
    '<div class="spinner"></div> Calculating enterprise budget metrics...',
    '<button class="action-button secondary" onclick="closeModal()">Close</button>'
  );

  try {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/accounts/budget-analysis`, {
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    if (!res.ok) throw new Error('Failed to fetch budget analysis data');
    const data = await res.json();

    const { budget, metrics, departments } = data;

    let bannerClass = 'budget-banner-green';
    if (budget.statusColor === 'Red') bannerClass = 'budget-banner-red';
    else if (budget.statusColor === 'Yellow') bannerClass = 'budget-banner-yellow';

    const deptRows = Object.keys(departments).map(dept => `
      <tr>
        <td><strong>${escapeHtml(dept)}</strong></td>
        <td>${formatCurrency(departments[dept].pending)}</td>
        <td>${formatCurrency(departments[dept].approved)}</td>
        <td><strong>${formatCurrency(departments[dept].total)}</strong></td>
      </tr>
    `).join('');

    const bodyHtml = `
      <div class="budget-modal-container">
        <div class="budget-banner ${bannerClass}">
          <div class="budget-banner-icon">
            ${budget.statusColor === 'Red' ? '🚨' : (budget.statusColor === 'Yellow' ? '⚠️' : '✅')}
          </div>
          <div>
            <h4 class="budget-banner-title">${escapeHtml(budget.statusText)}</h4>
            <p class="budget-banner-desc">Budget Utilization is currently at <strong>${budget.usedPercent}%</strong> of allocated pool (${formatCurrency(budget.used)} of ${formatCurrency(budget.allocated)}).</p>
          </div>
        </div>

        <div class="budget-progress-container">
          <div class="budget-progress-labels">
            <span>Budget Used: ${budget.usedPercent}%</span>
            <span>Allocated: ${formatCurrency(budget.allocated)}</span>
          </div>
          <div class="budget-progress-bar-bg">
            <div class="budget-progress-bar-fill fill-${budget.statusColor.toLowerCase()}" style="width: ${Math.min(100, budget.usedPercent)}%;"></div>
          </div>
        </div>

        <div class="budget-metrics-grid">
          <div class="budget-metric-card">
            <span class="budget-metric-label">Total Department Spending</span>
            <strong class="budget-metric-val">${formatCurrency(metrics.totalSpending)}</strong>
          </div>
          <div class="budget-metric-card">
            <span class="budget-metric-label">Department Pending</span>
            <strong class="budget-metric-val">${formatCurrency(metrics.totalPending)}</strong>
          </div>
          <div class="budget-metric-card">
            <span class="budget-metric-label">Department Approved</span>
            <strong class="budget-metric-val">${formatCurrency(metrics.totalApproved)}</strong>
          </div>
          <div class="budget-metric-card">
            <span class="budget-metric-label">Largest Request</span>
            <strong class="budget-metric-val">${formatCurrency(metrics.largestRequest)}</strong>
          </div>
          <div class="budget-metric-card">
            <span class="budget-metric-label">Average Request Amount</span>
            <strong class="budget-metric-val">${formatCurrency(metrics.avgRequestAmount)}</strong>
          </div>
          <div class="budget-metric-card">
            <span class="budget-metric-label">Budget Remaining</span>
            <strong class="budget-metric-val green-text">${formatCurrency(budget.remaining)}</strong>
          </div>
        </div>

        <div class="budget-dept-section">
          <h4 class="budget-sub-title">Department Breakdown</h4>
          <table class="budget-dept-table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Pending</th>
                <th>Approved</th>
                <th>Total Spending</th>
              </tr>
            </thead>
            <tbody>
              ${deptRows || '<tr><td colspan="4">No department breakdown available.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const footerHtml = `
      <button class="action-button secondary" onclick="closeModal()">Close</button>
    `;

    openModal('Budget Analysis', bodyHtml, footerHtml);
  } catch (err) {
    openModal(
      'Budget Analysis',
      `<div class="error-box">Error loading budget metrics: ${escapeHtml(err.message)}</div>`,
      '<button class="action-button secondary" onclick="closeModal()">Close</button>'
    );
  }
}

/* ==================================================
 * 3. FINANCIAL ALERTS MODULE
 * ================================================== */
async function loadFinancialAlerts() {
  const alertList = document.getElementById('alert-list');
  if (!alertList) return;

  try {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/accounts/financial-alerts`, {
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    if (!res.ok) throw new Error('Failed to fetch financial alerts');
    const data = await res.json();

    const alerts = Array.isArray(data.alerts) ? data.alerts : [];

    if (alerts.length === 0) {
      alertList.innerHTML = '<li class="alert-item alert-info">No critical financial alerts.</li>';
      return;
    }

    alertList.innerHTML = alerts.map(a => {
      let badgeClass = 'alert-info';
      if (a.type === 'critical') badgeClass = 'alert-critical';
      else if (a.type === 'warning') badgeClass = 'alert-warning';

      return `
        <li class="alert-item ${badgeClass}">
          <span class="alert-text">${escapeHtml(a.text)}</span>
          <span class="alert-prio-badge prio-${String(a.priority || 'Low').toLowerCase()}">${escapeHtml(a.priority || 'Normal')}</span>
        </li>
      `;
    }).join('');
  } catch (err) {
    console.error('[FinancialAlerts] Error:', err.message);
    alertList.innerHTML = '<li class="alert-item alert-info">No critical financial alerts.</li>';
  }
}

/* ==================================================
 * 4. ANALYTICS CHARTS MODULE
 * ================================================== */
async function loadAnalyticsCharts() {
  const departmentCanvas = document.getElementById('department-chart-canvas');
  const monthlyCanvas = document.getElementById('monthly-chart-canvas');
  const approvalCanvas = document.getElementById('approval-chart-canvas');

  if (!departmentCanvas || !monthlyCanvas || !approvalCanvas) return;

  try {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/accounts/charts`, {
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    if (!res.ok) throw new Error('Failed to fetch charts data');
    const data = await res.json();

    const { departmentChart, monthlyChart, distributionChart } = data;

    const commonOptions = {
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#cbd5e1', font: { family: 'inherit', size: 12 } } } },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.08)' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.08)' } }
      }
    };

    // 1. Amount by Department (Bar Chart)
    if (chartInstances.dept) chartInstances.dept.destroy();
    chartInstances.dept = new Chart(departmentCanvas, {
      type: 'bar',
      data: {
        labels: departmentChart.labels,
        datasets: [{
          label: 'Amount ($)',
          data: departmentChart.data,
          backgroundColor: ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa'],
          borderRadius: 8
        }]
      },
      options: commonOptions
    });

    // 2. Monthly Expense (Line Chart)
    if (chartInstances.monthly) chartInstances.monthly.destroy();
    chartInstances.monthly = new Chart(monthlyCanvas, {
      type: 'line',
      data: {
        labels: monthlyChart.labels,
        datasets: [{
          label: 'Expense ($)',
          data: monthlyChart.data,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.15)',
          tension: 0.3,
          fill: true,
          pointBackgroundColor: '#ffffff'
        }]
      },
      options: commonOptions
    });

    // 3. Approval Distribution (Pie / Doughnut Chart)
    if (chartInstances.distribution) chartInstances.distribution.destroy();
    chartInstances.distribution = new Chart(approvalCanvas, {
      type: 'doughnut',
      data: {
        labels: distributionChart.labels,
        datasets: [{
          data: distributionChart.data,
          backgroundColor: ['#22c55e', '#f59e0b', '#ef4444', '#94a3b8'],
          borderWidth: 2,
          borderColor: '#091626'
        }]
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: '#cbd5e1' } } }
      }
    });
  } catch (err) {
    console.error('[AnalyticsCharts] Error:', err.message);
  }
}

/* ==================================================
 * 5. EXPORT FINANCIAL REPORT MODULE
 * ================================================== */
async function openExportModal() {
  const searchInput = document.getElementById('searchBox');
  const q = searchInput ? searchInput.value : '';

  const bodyHtml = `
    <div class="export-modal-container">
      <p class="modal-intro">Export an audit-ready CSV report for currently filtered requests.</p>
      <div class="export-summary-box">
        <div><strong>Current Status Filter:</strong> ${escapeHtml(currentFilter)}</div>
        <div><strong>Search Query:</strong> ${q ? escapeHtml(q) : 'None'}</div>
        <div><strong>Requests Count:</strong> ${accountsRequestsCache.length} requests</div>
      </div>
    </div>
  `;

  const footerHtml = `
    <button class="action-button secondary" onclick="closeModal()">Cancel</button>
    <button class="action-button primary" onclick="exportCSV(); closeModal();">Download CSV Report</button>
  `;

  openModal('Export Financial Report', bodyHtml, footerHtml);
}

async function exportCSV() {
  try {
    const searchInput = document.getElementById('searchBox');
    const q = searchInput ? searchInput.value : '';
    const token = getAuthToken();

    const url = `${API_BASE}/accounts/export?status=${encodeURIComponent(currentFilter)}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });

    if (!res.ok) throw new Error('Failed to generate export file');
    const result = await res.json();
    const rows = Array.isArray(result.data) ? result.data : [];

    let csvContent = 'Request ID,Employee,Department,Amount,Priority,Status,Current Approver,Created Date\n';

    rows.forEach(r => {
      csvContent += `"${r.request_id}","${escapeHtml(r.employee)}","${escapeHtml(r.department)}",${r.amount},"${r.priority}","${r.status}","${escapeHtml(r.current_approver)}","${r.created_date}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `ZyroFlow_Financial_Report_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Financial report exported successfully.', 'success');
  } catch (err) {
    showToast(`Export failed: ${err.message}`, 'error');
  }
}

/* ==================================================
 * 6. NOTIFICATION BELL MODULE
 * ================================================== */
async function loadNotifications() {
  try {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/accounts/notifications`, {
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    if (!res.ok) return;
    const data = await res.json();

    const notifCount = document.getElementById('notifCount');
    const unreadBadge = document.getElementById('notifUnreadBadge');
    const notifList = document.getElementById('notifList');

    const count = data.unreadCount || 0;
    if (notifCount) notifCount.textContent = String(count);
    if (unreadBadge) unreadBadge.textContent = `${count} unread`;

    const list = Array.isArray(data.notifications) ? data.notifications : [];
    if (notifList) {
      if (list.length === 0) {
        notifList.innerHTML = '<div class="notif-empty">No notifications</div>';
      } else {
        notifList.innerHTML = list.map(n => `
          <div class="notif-item ${n.is_read ? 'read' : 'unread'}" onclick="onNotificationClick(${n.id}, ${n.request_id})">
            <div class="notif-title">${escapeHtml(n.title)}</div>
            <div class="notif-msg">${escapeHtml(n.message)}</div>
            <div class="notif-time">${new Date(n.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('[Notifications] Error:', err.message);
  }
}

function toggleNotificationDropdown(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('notifDropdown');
  if (dropdown) {
    dropdown.classList.toggle('open');
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const notifContainer = document.querySelector('.notification-container');
  const dropdown = document.getElementById('notifDropdown');
  if (dropdown && notifContainer && !notifContainer.contains(e.target)) {
    dropdown.classList.remove('open');
  }
});

async function onNotificationClick(notifId, requestId) {
  try {
    const token = getAuthToken();
    await fetch(`${API_BASE}/accounts/notifications/${notifId}/read`, {
      method: 'PUT',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    }).catch(() => {});
  } catch (e) {}

  if (requestId) {
    window.location.href = `review-request.html?id=${encodeURIComponent(requestId)}`;
  } else {
    loadNotifications();
  }
}

// Logout helper
function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('auth_token');
  localStorage.removeItem('currentUser');
  localStorage.removeItem('role');
  window.location.href = 'login.html';
}

// Global Aliases for HTML Event Attributes
window.renderRequests = renderAccountsQueue;
window.loadRequests = loadAccountsRequests;
window.filterRequests = filterRequests;
window.navigateToReview = navigateToReview;
window.scrollToQueue = scrollToQueue;
window.logout = logout;
window.openVerificationModal = openVerificationModal;
window.openBudgetModal = openBudgetModal;
window.openExportModal = openExportModal;
window.exportCSV = exportCSV;
window.closeModal = closeModal;
window.loadFinancialAlerts = loadFinancialAlerts;
window.toggleNotificationDropdown = toggleNotificationDropdown;
window.onPaymentVerificationSelectChange = onPaymentVerificationSelectChange;
window.onPvChecklistChange = onPvChecklistChange;
window.submitPaymentVerification = submitPaymentVerification;
window.getAccountsDecision = getAccountsDecision;
window.getAccountsDecisionDate = getAccountsDecisionDate;
