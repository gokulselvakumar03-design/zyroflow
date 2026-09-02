/**
 * ZyroFlow Notification Center
 * Handles real-time notifications, bell icon badge, dropdown UI, read status, deletion, and request navigation.
 * Auto-refreshes every 20 seconds.
 */

(function () {
  const NOTIFICATION_API_BASE = typeof API_BASE !== 'undefined' ? `${API_BASE}/notifications` : '/api/notifications';
  let notificationsData = [];
  let unreadCount = 0;
  let dropdownEl = null;
  let autoRefreshTimer = null;

  document.addEventListener('DOMContentLoaded', () => {
    initNotificationCenter();
  });

  function getToken() {
    return localStorage.getItem('authToken') || localStorage.getItem('auth_token') || '';
  }

  function getCurrentUser() {
    try {
      return JSON.parse(localStorage.getItem('currentUser') || 'null') || {};
    } catch (e) {
      return {};
    }
  }

  function getUserRole() {
    const u = getCurrentUser();
    return String(u.role || localStorage.getItem('user_role') || localStorage.getItem('role') || 'employee').toLowerCase();
  }

  function getUserEmail() {
    const u = getCurrentUser();
    return String(u.email || u.user_email || localStorage.getItem('userEmail') || localStorage.getItem('email') || localStorage.getItem('user_email') || '').toLowerCase().trim();
  }

  function injectNotificationStyles() {
    if (document.getElementById('zyroflow-notif-styles')) return;

    const style = document.createElement('style');
    style.id = 'zyroflow-notif-styles';
    style.textContent = `
      .notif-wrapper {
        position: relative;
        display: inline-block;
      }
      .notif-badge {
        background: #ef4444;
        color: #ffffff;
        font-size: 0.72rem;
        font-weight: 800;
        padding: 2px 6px;
        border-radius: 999px;
        margin-left: 6px;
        box-shadow: 0 0 10px rgba(239, 68, 68, 0.5);
      }
      .notif-badge.hidden {
        display: none !important;
      }

      /* Notification Dropdown Container */
      .notif-dropdown {
        position: absolute;
        top: calc(100% + 12px);
        right: 0;
        width: 390px;
        max-width: 92vw;
        background: #FFFFFF;
        border: 1px solid #E5E7EB;
        color: #111827;
        border-radius: 18px;
        box-shadow: 0 20px 45px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.05);
        backdrop-filter: blur(16px);
        z-index: 2500;
        overflow: hidden;
        display: none;
        animation: notifSlideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      .notif-dropdown.visible {
        display: block;
      }
      @keyframes notifSlideDown {
        0% { opacity: 0; transform: translateY(-10px) scale(0.98); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }

      .notif-header {
        padding: 16px 20px;
        border-bottom: 1px solid #F3F4F6;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #F9FAFB;
      }
      .notif-header-title {
        font-weight: 800;
        font-size: 1rem;
        color: #111827;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .notif-read-all-btn {
        background: none;
        border: none;
        color: #2563eb;
        font-size: 0.82rem;
        font-weight: 700;
        cursor: pointer;
        transition: color 0.2s ease;
      }
      .notif-read-all-btn:hover {
        color: #1d4ed8;
        text-decoration: underline;
      }

      /* Notification List Body */
      .notif-list {
        max-height: 380px;
        overflow-y: auto;
        padding: 6px 0;
      }
      .notif-item {
        padding: 14px 18px;
        border-bottom: 1px solid #F3F4F6;
        display: flex;
        align-items: flex-start;
        gap: 12px;
        transition: background 0.2s ease;
        position: relative;
        background: #FFFFFF;
      }
      .notif-item:last-child { border-bottom: none; }
      .notif-item:hover {
        background: #F8FAFC;
      }
      .notif-item.unread {
        background: #F0F7FF;
      }
      .notif-item.unread::before {
        content: '';
        position: absolute;
        left: 6px;
        top: 20px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #2563eb;
      }

      .notif-icon {
        width: 32px;
        height: 32px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.95rem;
        flex-shrink: 0;
        font-weight: 800;
      }
      .notif-icon.success { background: #ECFDF5; color: #059669; border: 1px solid #A7F3D0; }
      .notif-icon.error { background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; }
      .notif-icon.info { background: #EFF6FF; color: #2563eb; border: 1px solid #BFDBFE; }

      .notif-content { flex: 1; }
      .notif-title { font-weight: 800; font-size: 0.9rem; color: #111827; margin-bottom: 3px; }
      .notif-msg { font-size: 0.84rem; color: #4B5563; line-height: 1.4; word-break: break-word; font-weight: 500; }
      .notif-time { font-size: 0.74rem; color: #6B7280; margin-top: 5px; font-weight: 500; }

      .notif-item-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: 10px;
        flex-wrap: wrap;
      }
      .notif-act-btn {
        background: #F3F4F6;
        border: 1px solid #E5E7EB;
        color: #374151;
        font-size: 0.76rem;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .notif-act-btn:hover {
        background: #E5E7EB;
        color: #111827;
      }
      .notif-act-btn.primary-act {
        background: #EFF6FF;
        border-color: #BFDBFE;
        color: #1D4ED8;
      }
      .notif-act-btn.primary-act:hover {
        background: #DBEAFE;
        color: #1E40AF;
      }

      .notif-empty {
        padding: 40px 20px;
        text-align: center;
        color: #64748b;
        font-size: 0.9rem;
      }
      .notif-footer {
        padding: 10px;
        text-align: center;
        background: #F9FAFB;
        border-top: 1px solid #F3F4F6;
        font-size: 0.75rem;
        color: #64748b;
        font-weight: 600;
      }

      /* Dark Theme Overrides */
      html[data-theme="dark"] .notif-dropdown,
      body.dark-mode .notif-dropdown,
      body.dark .notif-dropdown {
        background: rgba(15, 23, 42, 0.98);
        border-color: rgba(255, 255, 255, 0.12);
        color: #FFFFFF;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
      }
      html[data-theme="dark"] .notif-header,
      body.dark-mode .notif-header,
      body.dark .notif-header {
        background: rgba(255, 255, 255, 0.03);
        border-bottom-color: rgba(255, 255, 255, 0.08);
      }
      html[data-theme="dark"] .notif-header-title,
      body.dark-mode .notif-header-title,
      body.dark .notif-header-title {
        color: #FFFFFF;
      }
      html[data-theme="dark"] .notif-item,
      body.dark-mode .notif-item,
      body.dark .notif-item {
        background: transparent;
        border-bottom-color: rgba(255, 255, 255, 0.04);
      }
      html[data-theme="dark"] .notif-item:hover,
      body.dark-mode .notif-item:hover,
      body.dark .notif-item:hover {
        background: rgba(255, 255, 255, 0.04);
      }
      html[data-theme="dark"] .notif-item.unread,
      body.dark-mode .notif-item.unread,
      body.dark .notif-item.unread {
        background: rgba(56, 189, 248, 0.08);
      }
      html[data-theme="dark"] .notif-title,
      body.dark-mode .notif-title,
      body.dark .notif-title {
        color: #FFFFFF;
      }
      html[data-theme="dark"] .notif-msg,
      body.dark-mode .notif-msg,
      body.dark .notif-msg {
        color: #CBD5E1;
      }
      html[data-theme="dark"] .notif-time,
      body.dark-mode .notif-time,
      body.dark .notif-time {
        color: #94A3B8;
      }
      html[data-theme="dark"] .notif-act-btn,
      body.dark-mode .notif-act-btn,
      body.dark .notif-act-btn {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.1);
        color: #E2E8F0;
      }
      html[data-theme="dark"] .notif-act-btn:hover,
      body.dark-mode .notif-act-btn:hover,
      body.dark .notif-act-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #FFFFFF;
      }
      html[data-theme="dark"] .notif-act-btn.primary-act,
      body.dark-mode .notif-act-btn.primary-act,
      body.dark .notif-act-btn.primary-act {
        background: rgba(56, 189, 248, 0.15);
        border-color: rgba(56, 189, 248, 0.3);
        color: #38BDF8;
      }
      html[data-theme="dark"] .notif-footer,
      body.dark-mode .notif-footer,
      body.dark .notif-footer {
        background: rgba(0, 0, 0, 0.25);
        border-top-color: rgba(255, 255, 255, 0.06);
        color: #64748B;
      }
    `;
    document.head.appendChild(style);
  }

  function initNotificationCenter() {
    injectNotificationStyles();

    // Find bell icon elements across all dashboards
    let notifBtn = document.getElementById('notifBtn') || document.querySelector('.notif-btn');
    
    if (!notifBtn) {
      // Find header actions to inject bell button if missing
      const navActions = document.querySelector('.nav-actions') || document.querySelector('.header-actions');
      if (navActions) {
        notifBtn = document.createElement('button');
        notifBtn.id = 'notifBtn';
        notifBtn.className = 'profile-pill btn ghost';
        notifBtn.innerHTML = `🔔 <span id="notifCount" class="notif-badge hidden">0</span>`;
        navActions.insertBefore(notifBtn, navActions.firstChild);
      }
    }

    if (notifBtn) {
      // Wrap in wrapper for relative positioning of dropdown
      if (!notifBtn.parentElement.classList.contains('notif-wrapper')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'notif-wrapper';
        notifBtn.parentNode.insertBefore(wrapper, notifBtn);
        wrapper.appendChild(notifBtn);
      }

      createDropdownUI(notifBtn.parentElement);

      notifBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown();
      });
    }

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (dropdownEl && !dropdownEl.contains(e.target) && !e.target.closest('#notifBtn')) {
        dropdownEl.classList.remove('visible');
      }
    });

    // Initial Fetch & Start 20-second Auto Refresh
    fetchNotifications();
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(fetchNotifications, 20000);
  }

  function createDropdownUI(parentElement) {
    if (document.getElementById('notifDropdownUI')) {
      dropdownEl = document.getElementById('notifDropdownUI');
      return;
    }

    dropdownEl = document.createElement('div');
    dropdownEl.id = 'notifDropdownUI';
    dropdownEl.className = 'notif-dropdown';
    dropdownEl.innerHTML = `
      <div class="notif-header">
        <div class="notif-header-title">
          <span>🔔 Notifications</span>
        </div>
        <button class="notif-read-all-btn" onclick="window.NotificationCenter.markAllRead()">Mark all as read</button>
      </div>
      <div class="notif-list" id="notifListContainer">
        <div class="notif-empty">Loading notifications...</div>
      </div>
      <div class="notif-footer">Auto-refreshes every 20 seconds</div>
    `;

    parentElement.appendChild(dropdownEl);
  }

  function toggleDropdown() {
    if (!dropdownEl) return;
    const isVisible = dropdownEl.classList.contains('visible');
    if (!isVisible) {
      fetchNotifications();
      dropdownEl.classList.add('visible');
    } else {
      dropdownEl.classList.remove('visible');
    }
  }

  let employeeRequestsSeqMap = new Map();

  async function updateEmployeeSeqMap() {
    const role = getUserRole();
    const email = getUserEmail();
    if (role !== 'employee') return;

    try {
      const token = getToken();
      const res = await fetch('/requests', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const reqs = await res.json();
        const myReqs = Array.isArray(reqs) ? reqs.filter(r => {
          if (!email) return true;
          const rEmail = String(r.requester_email || r.requesterEmail || r.email || '').toLowerCase();
          return rEmail === email;
        }) : [];

        const sorted = [...myReqs].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
        employeeRequestsSeqMap.clear();
        sorted.forEach((r, idx) => {
          employeeRequestsSeqMap.set(String(r.id), idx + 1);
        });
      }
    } catch (e) {
      console.warn('[NotificationCenter] Notice loading employee request sequence map:', e);
    }
  }

  async function fetchNotifications() {
    try {
      const role = getUserRole();
      const email = getUserEmail();
      const token = getToken();

      if (role === 'employee') {
        await updateEmployeeSeqMap();
      }

      let url = `${NOTIFICATION_API_BASE}?role=${encodeURIComponent(role)}`;
      if (email) url += `&email=${encodeURIComponent(email)}`;

      const response = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });

      if (!response.ok) return;

      const data = await response.json();
      if (data && data.success) {
        notificationsData = data.notifications || [];
        unreadCount = data.unread_count ?? notificationsData.filter(n => !n.is_read).length;
        updateBadgeUI();
        if (dropdownEl && dropdownEl.classList.contains('visible')) {
          renderNotificationsList();
        }
      }
    } catch (err) {
      console.error('[NotificationCenter] Error fetching notifications:', err);
    }
  }

  function updateBadgeUI() {
    const badgeEl = document.getElementById('notifCount') || document.querySelector('.notif-badge');
    if (!badgeEl) return;

    badgeEl.textContent = unreadCount;
    if (unreadCount > 0) {
      badgeEl.classList.remove('hidden');
      badgeEl.style.display = 'inline-block';
    } else {
      badgeEl.classList.add('hidden');
      badgeEl.style.display = 'none';
    }
  }

  function renderNotificationsList() {
    const container = document.getElementById('notifListContainer');
    if (!container) return;

    if (notificationsData.length === 0) {
      container.innerHTML = `<div class="notif-empty">No notifications yet.</div>`;
      return;
    }

    container.innerHTML = notificationsData.map(n => {
      let icon = 'ℹ️';
      let iconClass = 'info';
      if (n.type === 'success' || (n.title || '').includes('Approved') || (n.title || '').includes('Verified')) {
        icon = '✓';
        iconClass = 'success';
      } else if (n.type === 'error' || (n.title || '').includes('Rejected')) {
        icon = '❌';
        iconClass = 'error';
      }

      const rawReqId = n.request_id;
      const role = getUserRole();
      let displayReqId = rawReqId;
      if (role === 'employee' && rawReqId) {
        displayReqId = employeeRequestsSeqMap.get(String(rawReqId)) || rawReqId;
      }

      let displayTitle = n.title || 'Notification';
      if (displayReqId && !displayTitle.includes('#')) {
        displayTitle = `${displayTitle} (Request #${displayReqId})`;
      } else if (displayReqId && displayTitle.includes('#')) {
        displayTitle = displayTitle.replace(/\(Request\s*#\d+\)/i, `(Request #${displayReqId})`);
      }

      let displayMsg = n.message || '';
      if (role === 'employee' && rawReqId && displayReqId !== rawReqId) {
        displayMsg = displayMsg.replace(new RegExp(`Request\\s*#?${rawReqId}\\b`, 'gi'), `Request #${displayReqId}`);
      }

      const viewReqBtn = rawReqId ? `<button class="notif-act-btn primary-act" onclick="window.NotificationCenter.viewRequest('${rawReqId}')">🔍 View Request</button>` : '';
      const readBtn = !n.is_read ? `<button class="notif-act-btn" onclick="window.NotificationCenter.markRead('${n.id}')">Mark Read</button>` : '';

      return `
        <div class="notif-item ${!n.is_read ? 'unread' : ''}">
          <div class="notif-icon ${iconClass}">${icon}</div>
          <div class="notif-content">
            <div class="notif-title">${escapeHtml(displayTitle)}</div>
            <div class="notif-msg">${escapeHtml(displayMsg)}</div>
            <div class="notif-time">${formatTimeAgo(n.created_at)}</div>
            <div class="notif-item-actions">
              ${viewReqBtn}
              ${readBtn}
              <button class="notif-act-btn" onclick="window.NotificationCenter.deleteNotif('${n.id}')">🗑️ Delete</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async function markRead(id) {
    try {
      const token = getToken();
      await fetch(`${NOTIFICATION_API_BASE}/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      fetchNotifications();
    } catch (e) {
      console.error('Error marking notification read:', e);
    }
  }

  async function markAllRead() {
    try {
      const role = getUserRole();
      const email = getUserEmail();
      const token = getToken();

      await fetch(`${NOTIFICATION_API_BASE}/read-all`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ role, email })
      });
      fetchNotifications();
    } catch (e) {
      console.error('Error marking all notifications read:', e);
    }
  }

  async function deleteNotif(id) {
    try {
      const token = getToken();
      await fetch(`${NOTIFICATION_API_BASE}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      fetchNotifications();
    } catch (e) {
      console.error('Error deleting notification:', e);
    }
  }

  function viewRequest(reqId) {
    if (dropdownEl) dropdownEl.classList.remove('visible');
    const role = getUserRole();

    if (role === 'employee') {
      window.location.href = `employee-request-tracking.html?id=${reqId}`;
    } else {
      window.location.href = `review-request.html?id=${reqId}`;
    }
  }

  function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Just now';
    const date = new Date(timestamp);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Export global NotificationCenter API
  window.NotificationCenter = {
    init: initNotificationCenter,
    fetch: fetchNotifications,
    markRead: markRead,
    markAllRead: markAllRead,
    deleteNotif: deleteNotif,
    viewRequest: viewRequest
  };
})();
