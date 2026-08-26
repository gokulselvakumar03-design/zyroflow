/**
 * ZyroFlow Advanced Workflow JS Module
 * Enterprise Request Details Modal, Advanced Search, Smart Multi-Filters, Date Range Filter, Decision Reasons, and Real-Time Dashboard Refresh
 */

const ZyroWorkflow = (function () {
  'use strict';

  let currentRole = localStorage.getItem('user_role') || localStorage.getItem('role') || 'Manager';
  let cachedRequests = [];
  let filterState = {
    searchQuery: '',
    status: 'Pending',
    priority: 'ALL',
    department: 'ALL',
    requestType: 'ALL',
    fromDate: '',
    toDate: ''
  };

  let activeCallbacks = {
    renderTable: null,
    updateMetrics: null,
    updateCharts: null,
    updateHistory: null
  };

  // Helper: Format currency
  function formatCurrency(amt) {
    const num = Number(amt || 0);
    return '₹' + num.toLocaleString('en-IN');
  }

  // Helper: Format Date
  function formatDate(dtStr) {
    if (!dtStr) return 'N/A';
    try {
      const dt = new Date(dtStr);
      if (isNaN(dt.getTime())) return String(dtStr);
      return dt.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return String(dtStr);
    }
  }

  // Helper: Escape HTML
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Helper: Get Authorization Token
  function getAuthToken() {
    return localStorage.getItem('authToken') || localStorage.getItem('auth_token') || '';
  }

  // Helper: Toast Notifications
  function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:10px;';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const bg = type === 'success' ? '#10B981' : (type === 'error' ? '#EF4444' : '#2563EB');
    toast.style.cssText = `background:${bg};color:#fff;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:all 0.3s ease;`;
    toast.innerHTML = escapeHtml(message);
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  /* =========================================================
     1. FILTER & SEARCH ENGINE
     ========================================================= */

  function applyFilters(dataset) {
    const list = dataset || cachedRequests;
    if (!Array.isArray(list)) return [];

    return list.filter(item => {
      // 1. Search Query Filter
      if (filterState.searchQuery) {
        const q = filterState.searchQuery.toLowerCase().trim();
        const idStr = String(item.id || item.request_id || '');
        const name = String(item.employee_name || item.requester_name || item.requester_email || item.employee_id || '').toLowerCase();
        const dept = String(item.department || '').toLowerCase();
        const type = String(item.request_type || item.type || item.title || '').toLowerCase();
        const amt = String(item.amount || '');

        const matches = idStr.includes(q) || name.includes(q) || dept.includes(q) || type.includes(q) || amt.includes(q);
        if (!matches) return false;
      }

      // 2. Status Filter (Based on Accounts approval decision)
      if (filterState.status && filterState.status !== 'ALL') {
        const targetStatus = filterState.status.toLowerCase();
        let dec = 'pending';

        if (typeof window.getAccountsDecision === 'function') {
          dec = window.getAccountsDecision(item).toLowerCase();
        } else {
          const decProp = String(item.accounts_decision || item.accounts_approval_status || '').toLowerCase().trim();
          if (['pending', 'approved', 'rejected'].includes(decProp)) {
            dec = decProp;
          } else {
            dec = 'pending';
          }
        }

        if (targetStatus === 'pending' && dec !== 'pending') return false;
        if (targetStatus === 'approved' && dec !== 'approved') return false;
        if (targetStatus === 'rejected' && dec !== 'rejected') return false;
        if (targetStatus === 'escalated' && dec !== 'escalated') return false;
      }

      // 3. Priority Filter
      if (filterState.priority && filterState.priority !== 'ALL') {
        const itemPriority = String(item.priority || 'MEDIUM').toUpperCase();
        if (itemPriority !== filterState.priority.toUpperCase()) return false;
      }

      // 4. Department Filter
      if (filterState.department && filterState.department !== 'ALL') {
        const itemDept = String(item.department || '').toLowerCase();
        if (itemDept !== filterState.department.toLowerCase()) return false;
      }

      // 5. Request Type Filter
      if (filterState.requestType && filterState.requestType !== 'ALL') {
        const itemType = String(item.request_type || item.type || item.title || '').toLowerCase();
        if (!itemType.includes(filterState.requestType.toLowerCase())) return false;
      }

      // 6. Date Range Filter (Interacts with Accounts Status Filter)
      if (filterState.fromDate || filterState.toDate) {
        const targetStatus = String(filterState.status || '').toLowerCase().trim();

        // Pending status: IGNORE date filter because pending requests do not have an Accounts decision date
        if (targetStatus !== 'pending') {
          let itemDateStr = null;
          if (typeof window.getAccountsDecisionDate === 'function') {
            itemDateStr = window.getAccountsDecisionDate(item, targetStatus);
          }
          if (!itemDateStr) {
            itemDateStr = item.updated_at || item.created_at || item.submitted_date || item.timestamp;
          }

          if (itemDateStr) {
            const itemTime = new Date(itemDateStr).getTime();

            if (filterState.fromDate) {
              const fromTime = new Date(filterState.fromDate).setHours(0, 0, 0, 0);
              if (itemTime < fromTime) return false;
            }

            if (filterState.toDate) {
              const toTime = new Date(filterState.toDate).setHours(23, 59, 59, 999);
              if (itemTime > toTime) return false;
            }
          }
        }
      }

      return true;
    });
  }

  function renderFilterToolbar(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    activeCallbacks = {
      renderTable: options.renderTable || null,
      updateMetrics: options.updateMetrics || null,
      updateCharts: options.updateCharts || null,
      updateHistory: options.updateHistory || null
    };

    if (options.data) {
      cachedRequests = options.data;
    }

    container.innerHTML = `
      <div class="zyro-filter-toolbar">
        <!-- Advanced Instant Search -->
        <div class="zyro-search-container">
          <span class="zyro-search-icon">🔍</span>
          <input type="text" id="zyro-search-input" class="zyro-search-input" placeholder="Search by ID, Name, Department, Type, Amount..." value="${escapeHtml(filterState.searchQuery)}">
        </div>

        <!-- Smart Multi-Filters -->
        <div class="zyro-smart-filters">
          <select id="zyro-filter-status" class="zyro-filter-select">
            <option value="Pending" ${filterState.status === 'Pending' ? 'selected' : ''}>Pending</option>
            <option value="Approved" ${filterState.status === 'Approved' ? 'selected' : ''}>Approved</option>
            <option value="Rejected" ${filterState.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
            <option value="ALL" ${filterState.status === 'ALL' ? 'selected' : ''}>All Statuses</option>
          </select>

          <select id="zyro-filter-priority" class="zyro-filter-select">
            <option value="ALL">All Priorities</option>
            <option value="HIGH">High Priority</option>
            <option value="MEDIUM">Medium Priority</option>
            <option value="LOW">Low Priority</option>
          </select>

          <select id="zyro-filter-dept" class="zyro-filter-select">
            <option value="ALL">All Departments</option>
            <option value="Finance">Finance</option>
            <option value="Engineering">Engineering</option>
            <option value="HR">HR</option>
            <option value="Sales">Sales</option>
            <option value="Operations">Operations</option>
            <option value="Accounts">Accounts</option>
            <option value="IT">IT</option>
            <option value="Marketing">Marketing</option>
          </select>

          <select id="zyro-filter-type" class="zyro-filter-select">
            <option value="ALL">All Request Types</option>
            <option value="Travel">Travel</option>
            <option value="Equipment">Equipment</option>
            <option value="Software">Software</option>
            <option value="Capital Expenditure">Capital Expenditure</option>
            <option value="Reimbursement">Reimbursement</option>
            <option value="Purchase Request">Purchase Request</option>
            <option value="Maintenance">Maintenance</option>
            <option value="Training">Training</option>
            <option value="Leave Request">Leave Request</option>
            <option value="Budget Approval">Budget Approval</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <!-- Date Range Filter -->
        <div class="zyro-date-range-group">
          <input type="date" id="zyro-date-from" class="zyro-date-input" title="From Date" value="${filterState.fromDate}">
          <span style="color:var(--text-muted);font-size:13px;">to</span>
          <input type="date" id="zyro-date-to" class="zyro-date-input" title="To Date" value="${filterState.toDate}">
          <button id="zyro-btn-apply-date" class="zyro-btn-filter-apply">Apply</button>
          <button id="zyro-btn-clear-filters" class="zyro-btn-filter-clear">Clear</button>
        </div>
      </div>
    `;

    // Attach Event Listeners
    const searchInput = document.getElementById('zyro-search-input');
    const statusSelect = document.getElementById('zyro-filter-status');
    const prioritySelect = document.getElementById('zyro-filter-priority');
    const deptSelect = document.getElementById('zyro-filter-dept');
    const typeSelect = document.getElementById('zyro-filter-type');
    const fromDateInput = document.getElementById('zyro-date-from');
    const toDateInput = document.getElementById('zyro-date-to');
    const applyDateBtn = document.getElementById('zyro-btn-apply-date');
    const clearBtn = document.getElementById('zyro-btn-clear-filters');

    function triggerUpdate() {
      filterState.searchQuery = searchInput.value;
      filterState.status = statusSelect.value;
      filterState.priority = prioritySelect.value;
      filterState.department = deptSelect.value;
      filterState.requestType = typeSelect.value;
      filterState.fromDate = fromDateInput.value;
      filterState.toDate = toDateInput.value;

      const filtered = applyFilters(cachedRequests);

      if (typeof activeCallbacks.renderTable === 'function') {
        activeCallbacks.renderTable(filtered);
      }
      if (typeof activeCallbacks.updateMetrics === 'function') {
        activeCallbacks.updateMetrics(filtered);
      }
      if (typeof activeCallbacks.updateCharts === 'function') {
        activeCallbacks.updateCharts(filtered);
      }
      if (typeof activeCallbacks.updateHistory === 'function') {
        activeCallbacks.updateHistory(filtered);
      }
    }

    searchInput.addEventListener('input', triggerUpdate);
    statusSelect.addEventListener('change', triggerUpdate);
    prioritySelect.addEventListener('change', triggerUpdate);
    deptSelect.addEventListener('change', triggerUpdate);
    typeSelect.addEventListener('change', triggerUpdate);

    applyDateBtn.addEventListener('click', triggerUpdate);

    clearBtn.addEventListener('click', () => {
      filterState = { searchQuery: '', status: 'ALL', priority: 'ALL', department: 'ALL', requestType: 'ALL', fromDate: '', toDate: '' };
      searchInput.value = '';
      statusSelect.value = 'ALL';
      prioritySelect.value = 'ALL';
      deptSelect.value = 'ALL';
      typeSelect.value = 'ALL';
      fromDateInput.value = '';
      toDateInput.value = '';
      triggerUpdate();
    });
  }

  function updateCache(data) {
    cachedRequests = Array.isArray(data) ? data : [];
  }

  /* =========================================================
     2. REQUEST DETAILS POPUP MODAL
     ========================================================= */

  function injectModalHTML() {
    if (document.getElementById('zyro-request-details-modal')) return;

    const modalHTML = `
      <!-- Request Details Popup Modal -->
      <div id="zyro-request-details-modal" class="zyro-modal-backdrop">
        <div class="zyro-modal-content">
          <div class="zyro-modal-header">
            <div class="zyro-modal-title-group">
              <h3 id="zyro-modal-req-id" class="zyro-modal-title">Request Details</h3>
              <span id="zyro-modal-status-badge" class="zyro-filter-tag">Pending</span>
            </div>
            <button class="zyro-modal-close-btn" onclick="ZyroWorkflow.closeDetailsModal()">&times;</button>
          </div>

          <div class="zyro-modal-body">
            <!-- Key Details Grid -->
            <div class="zyro-details-grid">
              <div class="zyro-detail-card">
                <span class="zyro-detail-label">Employee Name</span>
                <span id="zyro-detail-emp-name" class="zyro-detail-value">Loading...</span>
              </div>
              <div class="zyro-detail-card">
                <span class="zyro-detail-label">Employee Email</span>
                <span id="zyro-detail-emp-email" class="zyro-detail-value">Loading...</span>
              </div>
              <div class="zyro-detail-card">
                <span class="zyro-detail-label">Department</span>
                <span id="zyro-detail-dept" class="zyro-detail-value">Loading...</span>
              </div>
              <div class="zyro-detail-card">
                <span class="zyro-detail-label">Request Type</span>
                <span id="zyro-detail-type" class="zyro-detail-value">Loading...</span>
              </div>
              <div class="zyro-detail-card">
                <span class="zyro-detail-label">Amount</span>
                <span id="zyro-detail-amount" class="zyro-detail-value">Loading...</span>
              </div>
              <div class="zyro-detail-card">
                <span class="zyro-detail-label">Priority</span>
                <span id="zyro-detail-priority" class="zyro-detail-value">Loading...</span>
              </div>
              <div class="zyro-detail-card">
                <span class="zyro-detail-label">Current Stage</span>
                <span id="zyro-detail-stage" class="zyro-detail-value">Loading...</span>
              </div>
              <div class="zyro-detail-card">
                <span class="zyro-detail-label">Current Approver</span>
                <span id="zyro-detail-approver" class="zyro-detail-value">Loading...</span>
              </div>
              <div class="zyro-detail-card">
                <span class="zyro-detail-label">Submitted Date</span>
                <span id="zyro-detail-date" class="zyro-detail-value">Loading...</span>
              </div>
            </div>

            <!-- Description -->
            <div class="zyro-desc-box">
              <div class="zyro-desc-title">Description</div>
              <div id="zyro-detail-desc" class="zyro-desc-content">No description provided.</div>
            </div>

            <!-- Full Approval Timeline -->
            <div class="zyro-timeline-container">
              <div class="zyro-section-header">Approval Timeline</div>
              <div id="zyro-timeline-list" class="zyro-timeline-list">
                <!-- Timeline items rendered dynamically -->
              </div>
            </div>

            <!-- Decision History / Audit Log -->
            <div class="zyro-history-container">
              <div class="zyro-section-header">Decision History & Audit Trail</div>
              <table class="zyro-history-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Performer</th>
                    <th>Date & Time</th>
                    <th>Comments / Reason</th>
                  </tr>
                </thead>
                <tbody id="zyro-history-tbody">
                  <!-- History rows rendered dynamically -->
                </tbody>
              </table>
            </div>

            <!-- Attachments -->
            <div class="zyro-attachments-box">
              <div class="zyro-desc-title">Attachments</div>
              <div id="zyro-attachment-list" class="zyro-attachment-list">
                <!-- Attachments rendered dynamically -->
              </div>
            </div>
          </div>

          <div class="zyro-modal-footer">
            <button class="zyro-btn-filter-clear" onclick="ZyroWorkflow.closeDetailsModal()">Close</button>
            <button id="zyro-modal-btn-reject" class="zyro-btn-reject" style="display:none;">Reject Request</button>
            <button id="zyro-modal-btn-approve" class="zyro-btn-approve" style="display:none;">Approve Request</button>
          </div>
        </div>
      </div>

      <!-- Decision Reason Prompt Modal -->
      <div id="zyro-reason-modal" class="zyro-modal-backdrop">
        <div class="zyro-modal-content zyro-reason-modal-content">
          <div class="zyro-modal-header">
            <h3 id="zyro-reason-modal-title" class="zyro-modal-title">Decision Reason</h3>
            <button class="zyro-modal-close-btn" onclick="ZyroWorkflow.closeReasonModal()">&times;</button>
          </div>
          <div class="zyro-modal-body">
            <div id="zyro-pv-warning-box" style="display:none;"></div>
            <p id="zyro-reason-modal-subtitle" style="font-size:14px;color:var(--text-secondary);margin-bottom:12px;">Please enter decision comments:</p>
            <textarea id="zyro-reason-text" class="zyro-reason-textarea" placeholder="Enter reason / comment here..."></textarea>
            <div id="zyro-reason-error" class="zyro-field-error">Rejection reason is mandatory!</div>
          </div>
          <div class="zyro-modal-footer">
            <button class="zyro-btn-filter-clear" onclick="ZyroWorkflow.closeReasonModal()">Cancel</button>
            <button id="zyro-reason-submit-btn" class="zyro-btn-approve">Confirm Approval</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Global backdrop click listeners
    document.getElementById('zyro-request-details-modal').addEventListener('click', (e) => {
      if (e.target.id === 'zyro-request-details-modal') ZyroWorkflow.closeDetailsModal();
    });
    document.getElementById('zyro-reason-modal').addEventListener('click', (e) => {
      if (e.target.id === 'zyro-reason-modal') ZyroWorkflow.closeReasonModal();
    });
  }

  async function showRequestDetails(requestId) {
    injectModalHTML();
    const modal = document.getElementById('zyro-request-details-modal');
    modal.classList.add('open');

    try {
      const token = getAuthToken();
      const res = await fetch(`http://localhost:4000/api/requests/${requestId}`, {
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });

      if (!res.ok) throw new Error('Failed to fetch request details');
      const req = await res.json();

      // Populate basic info
      document.getElementById('zyro-modal-req-id').innerText = `Request #${req.id || requestId}`;

      const statusBadge = document.getElementById('zyro-modal-status-badge');
      const st = String(req.status || 'Pending').toLowerCase();
      statusBadge.innerText = req.status || 'Pending';
      statusBadge.className = `zyro-filter-tag ${st.includes('approve') ? 'status-approved' : (st.includes('reject') ? 'status-rejected' : 'status-pending')}`;

      document.getElementById('zyro-detail-emp-name').innerText = req.requester_name || req.employee_name || 'N/A';
      document.getElementById('zyro-detail-emp-email').innerText = req.requester_email || 'N/A';
      document.getElementById('zyro-detail-dept').innerText = req.department || 'N/A';
      document.getElementById('zyro-detail-type').innerText = req.type || req.request_type || req.title || 'N/A';
      document.getElementById('zyro-detail-amount').innerText = formatCurrency(req.amount);
      document.getElementById('zyro-detail-priority').innerText = req.priority || 'MEDIUM';
      document.getElementById('zyro-detail-stage').innerText = req.approval_stage || req.current_role || 'N/A';
      document.getElementById('zyro-detail-approver').innerText = req.current_approver || req.current_role || 'N/A';
      document.getElementById('zyro-detail-date').innerText = formatDate(req.created_at || req.submitted_date);
      document.getElementById('zyro-detail-desc').innerText = req.description || 'No description provided.';

      // Populate Approval Timeline
      const timelineList = document.getElementById('zyro-timeline-list');
      const steps = req.timeline || req.approvals || [];
      if (steps.length === 0) {
        timelineList.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No workflow steps defined.</div>';
      } else {
        timelineList.innerHTML = steps.map((step, idx) => {
          const stepStatus = String(step.status || 'pending').toLowerCase();
          const nodeClass = stepStatus === 'approved' ? 'approved' : (stepStatus === 'rejected' ? 'rejected' : 'pending');
          const icon = stepStatus === 'approved' ? '✓' : (stepStatus === 'rejected' ? '✕' : idx + 1);

          return `
            <div class="zyro-timeline-item">
              <div class="zyro-timeline-node ${nodeClass}">${icon}</div>
              <div class="zyro-timeline-info">
                <div class="zyro-timeline-role">${escapeHtml(step.approver_role || `Stage ${step.step}`)}</div>
                <div class="zyro-timeline-meta">Status: <strong style="text-transform:capitalize;">${escapeHtml(step.status)}</strong> ${step.updated_at ? `• ${formatDate(step.updated_at)}` : ''}</div>
                ${step.comments ? `<div class="zyro-timeline-comment">"${escapeHtml(step.comments)}"</div>` : ''}
              </div>
            </div>
          `;
        }).join('');
      }

      // Populate Decision History & Audit Log
      const historyTbody = document.getElementById('zyro-history-tbody');
      const history = req.approval_history || req.history || [];
      if (history.length === 0) {
        historyTbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted);text-align:center;">No decision history logged yet.</td></tr>';
      } else {
        historyTbody.innerHTML = history.map(h => `
          <tr>
            <td><strong>${escapeHtml(h.action || h.decision || 'Updated')}</strong></td>
            <td>${escapeHtml(h.performed_by || h.manager_name || 'System')}</td>
            <td>${formatDate(h.timestamp || h.decision_timestamp)}</td>
            <td>${escapeHtml(h.comments || h.rejection_reason || '-')}</td>
          </tr>
        `).join('');
      }

      // Populate Attachments & Photos
      const attachList = document.getElementById('zyro-attachment-list');
      if (attachList) {
        let payload = req.payload;
        if (typeof payload === 'string') {
          try { payload = JSON.parse(payload); } catch(e) { payload = {}; }
        }
        payload = payload || {};

        let attachListItems = [];
        if (Array.isArray(req.attachments) && req.attachments.length) {
          attachListItems.push(...req.attachments);
        }
        if (Array.isArray(payload.attachments) && payload.attachments.length) {
          attachListItems.push(...payload.attachments);
        }

        let dynamicPhoto = null;
        if (typeof payload === 'object' && payload !== null) {
          Object.keys(payload).forEach(k => {
            const val = payload[k];
            if (typeof val === 'string' && val.startsWith('data:image/')) {
              dynamicPhoto = val;
            }
          });
        }

        const singleUrl = req.receipt_url || req.attachment_url || req.image_url ||
          payload.attached_file_url || payload.receipt_file || payload.receipt_url ||
          payload.attachment || payload.image || payload.photo || payload.file ||
          payload.receipt_photo || payload.bill_image || payload.upload || dynamicPhoto ||
          payload.receipt_file_url;

        const singleName = req.fileName || req.file_name || payload.attached_file_name ||
          payload.fileName || payload.file_name || payload.receipt_name || 'Attached Photo / Document';

        if (singleUrl && typeof singleUrl === 'string' && singleUrl !== 'null' && singleUrl !== 'undefined') {
          attachListItems.push({ name: singleName, url: singleUrl });
        }

        function formatPhotoSrc(urlStr) {
          if (!urlStr || typeof urlStr !== 'string') return '';
          if (urlStr.startsWith('<svg')) {
            return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(urlStr);
          }
          if (urlStr.startsWith('data:image/svg+xml;utf8,<svg')) {
            const raw = urlStr.substring('data:image/svg+xml;utf8,'.length);
            return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(raw);
          }
          return urlStr;
        }

        if (attachListItems.length === 0) {
          attachList.innerHTML = '<span style="color:var(--text-muted);font-size:13px;">No attachments available.</span>';
        } else {
          attachList.innerHTML = attachListItems.map(att => {
            const rawUrl = typeof att === 'object' ? (att.url || att.data || '') : String(att);
            const nameStr = typeof att === 'object' ? (att.name || 'View Attachment') : 'View Attachment';
            const urlStr = formatPhotoSrc(rawUrl);
            const isImg = urlStr.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg)($|\?)/i.test(urlStr) || urlStr.includes('image') || urlStr.startsWith('<svg');

            if (isImg) {
              return `
                <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px; width: 100%;">
                  <div style="font-size: 12px; font-weight: 600; color: #60E8FF;">🖼️ ${escapeHtml(nameStr)}</div>
                  <img src="${escapeHtml(urlStr)}" alt="Attachment" style="max-width: 100%; max-height: 250px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); object-fit: contain; background: #000; cursor: pointer;" onclick="window.open('${escapeHtml(urlStr)}', '_blank')" />
                  <a href="${escapeHtml(urlStr)}" target="_blank" download="${escapeHtml(nameStr)}" class="zyro-attachment-chip" style="display: inline-flex; align-items: center; gap: 6px; width: fit-content; text-decoration: none;">
                    🔍 View / Download Image
                  </a>
                </div>
              `;
            }
            return `
              <a href="${escapeHtml(urlStr)}" target="_blank" download="${escapeHtml(nameStr)}" class="zyro-attachment-chip">
                📎 ${escapeHtml(nameStr)}
              </a>
            `;
          }).join('');
        }
      }

      // Configure Approve / Reject buttons inside Details Modal
      // Configure Approve / Reject buttons inside Details Modal (View Only mode: hide decision buttons)
      const approveBtn = document.getElementById('zyro-modal-btn-approve');
      const rejectBtn = document.getElementById('zyro-modal-btn-reject');
      if (approveBtn) approveBtn.style.display = 'none';
      if (rejectBtn) rejectBtn.style.display = 'none';

    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function closeDetailsModal() {
    const modal = document.getElementById('zyro-request-details-modal');
    if (modal) modal.classList.remove('open');
  }

  /* =========================================================
     3. DECISION REASON MODAL & HANDLER
     ========================================================= */

  let pendingDecision = { action: '', requestId: null, callback: null };

  function openDecisionModal(action, requestId, callback) {
    injectModalHTML();
    pendingDecision = { action, requestId, callback };

    const reasonModal = document.getElementById('zyro-reason-modal');
    const title = document.getElementById('zyro-reason-modal-title');
    const subtitle = document.getElementById('zyro-reason-modal-subtitle');
    const textarea = document.getElementById('zyro-reason-text');
    const errorDiv = document.getElementById('zyro-reason-error');
    const submitBtn = document.getElementById('zyro-reason-submit-btn');
    const warningBox = document.getElementById('zyro-pv-warning-box');

    textarea.value = '';
    errorDiv.style.display = 'none';

    let reqObj = (cachedRequests || []).find(r => Number(r.id || r.request_id) === Number(requestId));
    if (!reqObj && window.accountsRequestsCache) {
      reqObj = window.accountsRequestsCache.find(r => Number(r.id || r.request_id) === Number(requestId));
    }
    if (!reqObj) reqObj = {};

    const currRoleStr = String(reqObj.current_role || reqObj.currentRole || reqObj.current_approver || '').toLowerCase().trim();
    const isAccountsStage = currRoleStr === 'accounts' || (!currRoleStr && window.location.pathname.includes('accounts'));
    const isVerified = Number(reqObj.payment_verified ?? 0) === 1 || String(reqObj.payment_verification_status || '').toLowerCase() === 'verified';
    const isUnverifiedAccounts = isAccountsStage && !isVerified;

    if (action === 'reject') {
      if (warningBox) { warningBox.style.display = 'none'; warningBox.innerHTML = ''; }
      title.innerText = 'Reject Request';
      subtitle.innerHTML = 'Please enter a reason for rejecting this request:';
      submitBtn.className = 'zyro-btn-reject';
      submitBtn.innerText = 'Confirm Rejection';
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.style.cursor = 'pointer';
    } else {
      title.innerText = 'Approve Request';
      subtitle.innerHTML = 'Enter optional comments for this approval:';
      submitBtn.className = 'zyro-btn-approve';
      submitBtn.innerText = 'Confirm Approval';

      if (isUnverifiedAccounts) {
        if (warningBox) {
          warningBox.style.display = 'block';
          warningBox.innerHTML = `
            <div style="margin-bottom:14px; padding:12px 16px; background:rgba(245, 158, 11, 0.18); border:1px solid rgba(245, 158, 11, 0.4); border-radius:12px; color:#fbbf24; font-weight:700; font-size:14px; display:flex; align-items:center; gap:10px;">
              <span style="font-size:16px;">⚠️</span>
              <span>Payment Verification must be done first</span>
            </div>
          `;
        }
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
        submitBtn.style.cursor = 'not-allowed';
      } else {
        if (warningBox) { warningBox.style.display = 'none'; warningBox.innerHTML = ''; }
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
      }
    }

    submitBtn.onclick = submitDecision;
    reasonModal.classList.add('open');
  }

  function closeReasonModal() {
    const reasonModal = document.getElementById('zyro-reason-modal');
    if (reasonModal) reasonModal.classList.remove('open');
  }

  async function submitDecision() {
    const textarea = document.getElementById('zyro-reason-text');
    const errorDiv = document.getElementById('zyro-reason-error');
    const comments = textarea.value.trim();

    if (pendingDecision.action === 'approve') {
      let reqObj = (cachedRequests || []).find(r => Number(r.id || r.request_id) === Number(pendingDecision.requestId));
      if (!reqObj && window.accountsRequestsCache) {
        reqObj = window.accountsRequestsCache.find(r => Number(r.id || r.request_id) === Number(pendingDecision.requestId));
      }
      if (!reqObj) reqObj = {};
      const currRoleStr = String(reqObj.current_role || reqObj.currentRole || reqObj.current_approver || '').toLowerCase().trim();
      const isAccountsStage = currRoleStr === 'accounts' || (!currRoleStr && window.location.pathname.includes('accounts'));
      const isVerified = Number(reqObj.payment_verified ?? 0) === 1 || String(reqObj.payment_verification_status || '').toLowerCase() === 'verified';

      if (isAccountsStage && !isVerified) {
        errorDiv.innerText = 'Payment Verification must be done first';
        errorDiv.style.display = 'block';
        return;
      }
    }

    if (pendingDecision.action === 'reject' && !comments) {
      errorDiv.innerText = 'Rejection reason is required.';
      errorDiv.style.display = 'block';
      return;
    }

    errorDiv.style.display = 'none';

    try {
      const token = getAuthToken();
      const endpoint = pendingDecision.action === 'approve' ? 'http://localhost:4000/approve' : 'http://localhost:4000/reject';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          request_id: pendingDecision.requestId,
          comments: comments
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Action failed');

      showToast(`Request #${pendingDecision.requestId} ${pendingDecision.action === 'approve' ? 'approved' : 'rejected'} successfully!`, 'success');
      closeReasonModal();

      if (typeof pendingDecision.callback === 'function') {
        pendingDecision.callback();
      }

      // Auto Refresh Dashboard
      refreshDashboard();

    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function refreshDashboard() {
    // Trigger window custom refresh event if dashboard logic listens
    window.dispatchEvent(new CustomEvent('zyro-dashboard-refresh'));

    // Call existing refresh functions on page if defined
    if (typeof window.loadAccountsRequests === 'function') window.loadAccountsRequests();
    if (typeof window.loadRequests === 'function') window.loadRequests();
    if (typeof window.fetchPendingApprovals === 'function') window.fetchPendingApprovals();
    if (typeof window.loadDashboardData === 'function') window.loadDashboardData();
  }

  return {
    renderFilterToolbar,
    updateCache,
    applyFilters,
    showRequestDetails,
    closeDetailsModal,
    openDecisionModal,
    closeReasonModal,
    refreshDashboard
  };
})();

window.ZyroWorkflow = ZyroWorkflow;
