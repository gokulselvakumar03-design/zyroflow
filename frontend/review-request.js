/**
 * ZyroFlow - Review Request Client Logic
 * Handles detailed request inspection and Accounts approval/rejection workflow
 */

const API_BASE_URL = 'http://localhost:4000';
let currentRequestId = null;
let currentRequestData = null;
let pendingActionType = null;

// Helper to retrieve JWT Token
function getAuthToken() {
    return localStorage.getItem('authToken') || localStorage.getItem('auth_token') || '';
}

// Utility helper to format currency
function formatCurrency(val) {
    const num = Number(val || 0);
    return '₹' + num.toLocaleString('en-IN');
}

// Helper to escape HTML strings
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Helper to normalize status strings
function normalizeStatus(status) {
    return String(status || '').trim().toLowerCase();
}

// Standardize role names
function canonicalRole(roleValue) {
    const raw = String(roleValue || '').trim().toLowerCase();
    if (raw === 'accounts') return 'Accounts';
    if (raw === 'manager') return 'Manager';
    if (raw === 'cfo') return 'CFO';
    if (raw === 'md') return 'MD';
    if (raw === 'employee') return 'Employee';
    return 'Approver';
}

// Format priority badge
function getPriorityLabel(amount) {
    const num = Number(amount || 0);
    if (num >= 100000) return 'HIGH';
    if (num >= 25000) return 'MEDIUM';
    return 'LOW';
}

// Display error banner
function showError(message) {
    const loadingCard = document.getElementById('loading-state');
    const contentGrid = document.getElementById('request-content');
    const errorBanner = document.getElementById('error-banner');
    const errorMsg = document.getElementById('error-message');

    if (loadingCard) loadingCard.classList.add('d-none');
    if (contentGrid) contentGrid.classList.add('d-none');
    if (errorMsg) errorMsg.textContent = message || 'An error occurred while loading request.';
    if (errorBanner) errorBanner.classList.remove('d-none');
}

// Display success banner & redirect
function showSuccess(message) {
    const successBanner = document.getElementById('success-banner');
    const successMsg = document.getElementById('success-message');
    const actionSection = document.getElementById('action-section');

    if (actionSection) actionSection.classList.add('d-none');
    if (successMsg) successMsg.textContent = message || 'Action completed successfully! Redirecting...';
    if (successBanner) successBanner.classList.remove('d-none');

    // Redirect to Accounts Dashboard after 2 seconds
    setTimeout(() => {
        window.location.href = 'accounts-dashboard.html';
    }, 2000);
}

// Authentication and Authorization Check
function checkAuth() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    const token = getAuthToken();
    const userRole = (currentUser && currentUser.role) || localStorage.getItem('role') || localStorage.getItem('userRole') || '';

    if (!token && !currentUser) {
        showError('Unauthorized access. Please log in to continue.');
        setTimeout(() => { window.location.href = 'login.html'; }, 1500);
        return false;
    }

    const normRole = String(userRole).toLowerCase().trim();
    if (normRole !== 'accounts' && normRole !== 'admin') {
        showError('Access Denied. Only members of the Accounts Team or Admins can review this financial request.');
        return false;
    }

    const displayName = currentUser && currentUser.name ? currentUser.name : 'Accounts Team';
    const welcomeText = document.getElementById('welcomeText');
    if (welcomeText) welcomeText.textContent = `Good Morning, ${displayName}`;

    return true;
}

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;

    // Extract request ID from URL query parameters (e.g. review-request.html?id=19)
    const urlParams = new URLSearchParams(window.location.search);
    const idParam = urlParams.get('id');

    if (!idParam) {
        showError('Invalid or missing Request ID parameter in URL.');
        return;
    }

    currentRequestId = Number(idParam);
    if (!Number.isInteger(currentRequestId) || currentRequestId <= 0) {
        showError(`Invalid Request ID "${idParam}". Request ID must be a positive integer.`);
        return;
    }

    fetchRequestDetails(currentRequestId);
});

// Fetch complete request details from backend API
async function fetchRequestDetails(requestId) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_BASE_URL}/requests/${encodeURIComponent(requestId)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            }
        });

        if (response.status === 404) {
            showError(`Request #${requestId} was not found in the database.`);
            return;
        }

        if (response.status === 401 || response.status === 403) {
            showError(`Unauthorized: Access denied to Request #${requestId}.`);
            return;
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || `Server returned error status ${response.status}`);
        }

        const data = await response.json();
        console.log("Fetched Request Details:", data);
        currentRequestData = data;
        renderRequestDetails(data);
    } catch (err) {
        console.error('[ReviewRequest] Error fetching details:', err.message);
        showError(`Network / Connection Error: ${err.message}. Ensure backend is running at ${API_BASE_URL}.`);
    }
}

// Render data into HTML elements
function renderRequestDetails(req) {
    const loadingCard = document.getElementById('loading-state');
    const contentGrid = document.getElementById('request-content');

    if (loadingCard) loadingCard.classList.add('d-none');
    if (contentGrid) contentGrid.classList.remove('d-none');

    // Request ID & Title
    const idDisplay = document.getElementById('request-id-display');
    const titleHeading = document.getElementById('request-title');
    if (idDisplay) idDisplay.textContent = `#${req.id}`;
    if (titleHeading) titleHeading.textContent = req.title || req.request_type || req.type || 'Financial Request';

    // Priority Badge
    const priorityBadge = document.getElementById('priority-badge');
    const priorityText = getPriorityLabel(req.amount);
    if (priorityBadge) {
        priorityBadge.textContent = priorityText;
        priorityBadge.className = `priority-badge priority-${priorityText.toLowerCase()}`;
    }

    // Status Pill
    const statusPill = document.getElementById('status-pill');
    const normStatus = normalizeStatus(req.status);
    if (statusPill) {
        let label = 'Pending Review';
        if (normStatus === 'approved') label = 'Approved';
        if (normStatus === 'rejected') label = 'Rejected';
        if (normStatus === 'cancelled') label = 'Cancelled';
        statusPill.textContent = label;
        statusPill.className = `status-pill status-${normStatus}`;
    }

    // Details Grid Fields
    const empName = req.employee_name || req.requester_name || req.employee || req.requester || 'Employee';
    const dept = req.department || 'Finance';
    const reqType = req.request_type || req.type || req.title || 'Financial';
    const amountStr = formatCurrency(req.amount);
    const createdDateStr = req.createdAt || req.created_at ? new Date(req.createdAt || req.created_at).toLocaleString() : 'Recent';
    const currentApproverStr = req.current_approver || req.currentRole || req.current_role || 'Accounts';

    document.getElementById('detail-employee').textContent = empName;
    document.getElementById('detail-department').textContent = dept;
    document.getElementById('detail-type').textContent = reqType;
    document.getElementById('detail-amount').textContent = amountStr;
    document.getElementById('detail-date').textContent = createdDateStr;
    document.getElementById('detail-approver').textContent = currentApproverStr;

    // Payment Verification Card
    const isVerified = Number(req.payment_verified ?? 0) === 1 || String(req.payment_verification_status).toLowerCase() === 'verified';
    const pvStatusEl = document.getElementById('pv-card-status');
    const pvByEl = document.getElementById('pv-card-by');
    const pvAtEl = document.getElementById('pv-card-at');

    if (pvStatusEl) {
        pvStatusEl.innerHTML = isVerified
            ? `<span style="color: #10b981; font-weight: 600;">Verified</span>`
            : `<span style="color: #f59e0b; font-weight: 600;">Pending</span>`;
    }
    if (pvByEl) {
        pvByEl.textContent = req.payment_verified_by || '—';
    }
    if (pvAtEl) {
        pvAtEl.textContent = req.payment_verified_at ? new Date(req.payment_verified_at).toLocaleString() : '—';
    }

    // Description Box
    const descBox = document.getElementById('detail-description');
    if (descBox) {
        descBox.textContent = req.description || 'No detailed description was provided with this request submission.';
    }

    // Attachment photo / file preview box
    let attachContainer = document.getElementById('attached-file-box');
    if (!attachContainer) {
        attachContainer = document.createElement('div');
        attachContainer.id = 'attached-file-box';
        attachContainer.style.cssText = 'margin-top: 20px;';
        if (descBox && descBox.parentNode) {
            descBox.parentNode.insertBefore(attachContainer, descBox.nextSibling);
        }
    }

    let payload = req.payload;
    if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch(e) { payload = {}; }
    }
    payload = payload || {};

    let dynamicPhoto = null;
    if (typeof payload === 'object' && payload !== null) {
        Object.keys(payload).forEach(k => {
            const val = payload[k];
            if (typeof val === 'string' && val.startsWith('data:image/')) {
                dynamicPhoto = val;
            }
        });
    }

    const urlStr = req.receipt_url || req.attachment_url || req.image_url ||
        payload.attached_file_url || payload.receipt_file || payload.receipt_url ||
        payload.attachment || payload.image || payload.photo || payload.file ||
        payload.receipt_photo || payload.bill_image || payload.upload || dynamicPhoto;

    const nameStr = req.fileName || req.file_name || payload.attached_file_name || payload.fileName || 'Attached Photo / Receipt';

    if (urlStr && typeof urlStr === 'string' && urlStr !== 'null' && urlStr !== 'undefined') {
        const isImg = urlStr.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg)($|\?)/i.test(urlStr) || urlStr.includes('image');
        attachContainer.style.display = 'block';
        if (isImg) {
            attachContainer.innerHTML = `
                <div style="font-weight: 700; font-size: 14px; margin-bottom: 8px; color: #1e293b;">🖼️ Attached Photo / Receipt (${escapeHtml(nameStr)})</div>
                <div style="margin-bottom: 10px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; text-align: center;">
                    <img src="${escapeHtml(urlStr)}" alt="Attachment" style="max-width: 100%; max-height: 300px; border-radius: 6px; object-fit: contain; cursor: pointer;" onclick="window.open('${escapeHtml(urlStr)}', '_blank')" />
                </div>
                <a href="${escapeHtml(urlStr)}" target="_blank" download="${escapeHtml(nameStr)}" class="btn btn-secondary" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; font-size: 12px; border-radius: 6px; text-decoration: none;">
                    🔍 View / Download Image
                </a>
            `;
        } else {
            attachContainer.innerHTML = `
                <div style="font-weight: 700; font-size: 14px; margin-bottom: 8px; color: #1e293b;">📎 Attached Document (${escapeHtml(nameStr)})</div>
                <a href="${escapeHtml(urlStr)}" target="_blank" download="${escapeHtml(nameStr)}" class="btn btn-secondary" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; font-size: 12px; border-radius: 6px; text-decoration: none;">
                    📄 View / Download File
                </a>
            `;
        }
    } else {
        attachContainer.style.display = 'none';
    }

    // Render Timeline Stepper
    renderTimelineStepper(req);

    // If request is already approved or rejected, hide action section
    const actionSection = document.getElementById('action-section');
    if (actionSection && normStatus !== 'pending') {
        actionSection.innerHTML = `
            <div class="alert-banner alert-info">
                This request is currently in <strong>${normStatus.toUpperCase()}</strong> status and no further Accounts action is required.
            </div>
        `;
    }
}

// Render dynamic workflow stepper
function renderTimelineStepper(req) {
    const container = document.getElementById('workflow-timeline');
    if (!container) return;

    let chain = Array.isArray(req.workflow) && req.workflow.length > 0
        ? req.workflow
        : ['Accounts', 'Manager', 'CFO', 'MD'];

    // Prepend 'Employee' if not present so timeline shows submission step
    if (!chain.some(r => String(r).toLowerCase() === 'employee')) {
        chain = ['Employee', ...chain];
    }

    const currentLevel = Number(req.currentLevel ?? req.current_level ?? 0);
    const overallStatus = normalizeStatus(req.status);

    container.innerHTML = chain.map((role, idx) => {
        const roleName = canonicalRole(role);
        let stepState = 'upcoming'; // completed | active | rejected | upcoming
        let iconText = '○';
        let statusText = 'Waiting';

        if (roleName === 'Employee') {
            stepState = 'completed';
            iconText = '✓';
            statusText = 'Submitted';
        } else {
            // Find index offset relative to non-employee chain
            const approverIdx = idx - 1;

            if (overallStatus === 'rejected' && approverIdx === currentLevel) {
                stepState = 'rejected';
                iconText = '✕';
                statusText = 'Rejected';
            } else if (approverIdx < currentLevel || (overallStatus === 'approved')) {
                stepState = 'completed';
                iconText = '✓';
                statusText = 'Approved';
            } else if (approverIdx === currentLevel && overallStatus === 'pending') {
                stepState = 'active';
                iconText = '⏳';
                statusText = 'Pending Review';
            } else {
                stepState = 'upcoming';
                iconText = '○';
                statusText = 'Waiting';
            }
        }

        return `
            <div class="step-item ${stepState}">
                <div class="step-icon">${iconText}</div>
                <div class="step-role">${escapeHtml(roleName)}</div>
                <div class="step-status-text">${statusText}</div>
            </div>
        `;
    }).join('');
}

// Prompt Confirmation Modal
function promptAction(actionType) {
    pendingActionType = actionType;
    const commentsInput = document.getElementById('comments-input');
    const comments = commentsInput ? commentsInput.value.trim() : '';

    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const bodyEl = document.getElementById('confirm-modal-body');
    const submitBtn = document.getElementById('confirm-submit-btn');

    const amountStr = currentRequestData ? formatCurrency(currentRequestData.amount) : '₹0';
    const reqTitle = currentRequestData ? (currentRequestData.title || currentRequestData.type || 'Request') : 'Request';

    const currRoleStr = currentRequestData ? String(currentRequestData.current_role || currentRequestData.currentRole || currentRequestData.current_approver || '').toLowerCase().trim() : '';
    const isAccountsStage = currRoleStr === 'accounts' || (!currRoleStr && window.location.pathname.includes('accounts'));

    const isVerified = currentRequestData
        ? (Number(currentRequestData.payment_verified ?? 0) === 1 || String(currentRequestData.payment_verification_status || '').toLowerCase() === 'verified')
        : false;
    const isUnverifiedAccounts = isAccountsStage && !isVerified;

    if (actionType === 'approve') {
        if (titleEl) titleEl.textContent = 'Confirm Financial Approval';
        if (bodyEl) {
            const warningBanner = isUnverifiedAccounts
                ? `<div class="pv-warning-banner" style="margin-top: 14px; margin-bottom: 14px; padding: 12px 16px; background: rgba(245, 158, 11, 0.18); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 12px; color: #fbbf24; font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 16px;">⚠️</span>
                    <span>Payment Verification must be done first</span>
                   </div>`
                : '';

            const subNote = isUnverifiedAccounts
                ? `<p class="modal-note" style="margin-top: 10px; color: #f87171;">Payment Verification has not been completed. Please complete verification before approving.</p>`
                : `<p class="modal-note" style="margin-top: 10px; color: #94a3b8;">This will advance the request to the next approval queue.</p>`;

            bodyEl.innerHTML = `
                <p>Are you sure you want to <strong>APPROVE</strong> Request #${currentRequestId} (<em>${escapeHtml(reqTitle)}</em>) for <strong>${amountStr}</strong>?</p>
                ${warningBanner}
                ${subNote}
                ${comments ? `<p style="margin-top: 10px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;"><strong>Notes:</strong> ${escapeHtml(comments)}</p>` : ''}
            `;
        }
        if (submitBtn) {
            if (isUnverifiedAccounts) {
                submitBtn.textContent = 'Confirm Approval';
                submitBtn.className = 'action-button primary disabled';
                submitBtn.disabled = true;
                submitBtn.style.opacity = '0.5';
                submitBtn.style.cursor = 'not-allowed';
                submitBtn.style.background = '';
            } else {
                submitBtn.textContent = 'Yes, Approve Request';
                submitBtn.className = 'action-button primary';
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';
                submitBtn.style.background = '';
            }
        }
    } else {
        if (titleEl) titleEl.textContent = 'Confirm Financial Rejection';
        if (bodyEl) {
            bodyEl.innerHTML = `
                <p>Are you sure you want to <strong>REJECT</strong> Request #${currentRequestId} (<em>${escapeHtml(reqTitle)}</em>)?</p>
                <p class="modal-note" style="margin-top: 10px; color: #f87171;">This will halt the approval process for this request.</p>
                ${comments ? `<p style="margin-top: 10px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;"><strong>Reason:</strong> ${escapeHtml(comments)}</p>` : ''}
            `;
        }
        if (submitBtn) {
            submitBtn.textContent = 'Yes, Reject Request';
            submitBtn.className = 'action-button secondary';
            submitBtn.disabled = false;
            submitBtn.style.background = '#dc2626';
            submitBtn.style.opacity = '1';
            submitBtn.style.cursor = 'pointer';
        }
    }

    if (modal) modal.classList.add('open');
}

// Close Confirmation Modal
function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.remove('open');
    pendingActionType = null;
}

// Execute confirmed action via API
async function submitConfirmedAction() {
    if (!pendingActionType || !currentRequestId) return;
    const action = pendingActionType;

    if (action === 'approve') {
        const currRoleStr = currentRequestData ? String(currentRequestData.current_role || currentRequestData.currentRole || currentRequestData.current_approver || '').toLowerCase().trim() : '';
        const isAccountsStage = currRoleStr === 'accounts' || (!currRoleStr && window.location.pathname.includes('accounts'));
        const isVerified = currentRequestData
            ? (Number(currentRequestData.payment_verified ?? 0) === 1 || String(currentRequestData.payment_verification_status || '').toLowerCase() === 'verified')
            : false;

        if (isAccountsStage && !isVerified) {
            showError('Payment Verification must be done first');
            return;
        }
    }

    const commentsInput = document.getElementById('comments-input');
    const comments = commentsInput ? commentsInput.value.trim() : '';

    if (action === 'reject' && !comments) {
        showError('Rejection reason is required.');
        return;
    }

    closeConfirmModal();

    const approveBtn = document.getElementById('approve-btn');
    const rejectBtn = document.getElementById('reject-btn');
    if (approveBtn) approveBtn.disabled = true;
    if (rejectBtn) rejectBtn.disabled = true;

    const endpoint = `${API_BASE_URL}/requests/${currentRequestId}/${action}`;
    const token = getAuthToken();

    try {
        console.log(`Sending PUT ${endpoint}`, { comments });
        const response = await fetch(endpoint, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({ comments })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || errData.message || `API returned status ${response.status}`);
        }

        const resData = await response.json();
        console.log("Action API Response:", resData);

        showSuccess(action === 'approve'
            ? `Request #${currentRequestId} approved successfully! Request advanced to Manager.`
            : `Request #${currentRequestId} has been rejected.`
        );
    } catch (err) {
        console.error(`Error processing ${action}:`, err.message);
        // Fallback attempt to POST /approve if PUT route failed
        try {
            console.log('Attempting fallback POST /approve endpoint...');
            const fallbackRes = await fetch(`${API_BASE_URL}/approve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({
                    requestId: currentRequestId,
                    role: 'Accounts',
                    action: action === 'approve' ? 'approved' : 'rejected',
                    comments
                })
            });
            if (fallbackRes.ok) {
                showSuccess(action === 'approve'
                    ? `Request #${currentRequestId} approved successfully! Request advanced to Manager.`
                    : `Request #${currentRequestId} has been rejected.`
                );
                return;
            }
        } catch (fallbackErr) {
            console.error('Fallback POST /approve failed:', fallbackErr.message);
        }

        showError(`Failed to submit ${action}: ${err.message}`);
        if (approveBtn) approveBtn.disabled = false;
        if (rejectBtn) rejectBtn.disabled = false;
    }
}

// Global Aliases
window.promptAction = promptAction;
window.closeConfirmModal = closeConfirmModal;
window.submitConfirmedAction = submitConfirmedAction;
window.logout = function () {
    localStorage.removeItem('authToken');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('role');
    window.location.href = 'login.html';
};
