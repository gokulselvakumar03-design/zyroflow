/**
 * ZyroFlow Notification Center
 * Handles real-time notifications, bell icon badge, dropdown UI, read status, deletion, and request navigation.
 * Auto-refreshes every 20 seconds.
 */

(function () {
  const NOTIFICATION_API_BASE = typeof API_BASE !== 'undefined' ? `${API_BASE}/notifications` : 'http://localhost:4000/api/notifications';
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
    return String(u.email || localStorage.getItem('userEmail') || localStorage.getItem('email') || '').toLowerCase();
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
        width: 380px;
        max-width: 92vw;
        background: var(--surface, rgba(9, 18, 36, 0.98));
        border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
        color: var(--text-primary, #ffffff);
        border-radius: 20px;
        box-shadow: var(--shadow, 0 20px 50px rgba(0, 0, 0, 0.5));
        backdrop-filter: blur(12px);
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
        border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--card, rgba(255, 255, 255, 0.02));
      }
      .notif-header-title {
        font-weight: 800;
        font-size: 1rem;
        color: var(--text-primary, #ffffff);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .notif-read-all-btn {
        background: none;
        border: none;
        color: #38bdf8;
        font-size: 0.8rem;
        font-weight: 700;
        cursor: pointer;
        transition: color 0.2s ease;
      }
      .notif-read-all-btn:hover {
        color: #7dd3fc;
        text-decoration: underline;
      }

      /* Notification List Body */
      .notif-list {
        max-height: 380px;
        overflow-y: auto;
        padding: 8px 0;
      }
      .notif-item {
        padding: 14px 18px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        display: flex;
        align-items: flex-start;
        gap: 12px;
        transition: background 0.2s ease;
        position: relative;
      }
      .notif-item:last-child { border-bottom: none; }
      .notif-item:hover {
        background: rgba(255, 255, 255, 0.04);
      }
      .notif-item.unread {
        background: rgba(56, 189, 248, 0.06);
      }
      .notif-item.unread::before {
        content: '';
        position: absolute;
        left: 6px;
        top: 20px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #38bdf8;
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
      }
      .notif-icon.success { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
      .notif-icon.error { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
      .notif-icon.info { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }

      .notif-content { flex: 1; }
      .notif-title { font-weight: 700; font-size: 0.88rem; color: #ffffff; margin-bottom: 2px; }
      .notif-msg { font-size: 0.82rem; color: #cbd5e1; line-height: 1.35; word-break: break-word; }
      .notif-time { font-size: 0.72rem; color: #94a3b8; margin-top: 4px; }

      .notif-item-actions {
        display: flex;
        gap: 6px;
        align-items: center;
        margin-top: 8px;
      }
      .notif-act-btn {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #e2e8f0;
        font-size: 0.75rem;
        padding: 3px 8px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .notif-act-btn:hover {
        background: rgba(255, 255, 255, 0.12);
        color: #ffffff;
      }
      .notif-act-btn.primary-act {
        background: rgba(56, 189, 248, 0.15);
        border-color: rgba(56, 189, 248, 0.3);
        color: #38bdf8;
      }
      .notif-act-btn.primary-act:hover {
        background: rgba(56, 189, 248, 0.25);
      }

      .notif-empty {
        padding: 40px 20px;
        text-align: center;
        color: #94a3b8;
        font-size: 0.9rem;
      }
      .notif-footer {
        padding: 10px;
        text-align: center;
        background: rgba(0, 0, 0, 0.2);
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 0.75rem;
        color: #64748b;
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

  async function fetchNotifications() {
    try {
      const role = getUserRole();
      const email = getUserEmail();
      const token = getToken();

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

      const reqId = n.request_id;
      const viewReqBtn = reqId ? `<button class="notif-act-btn primary-act" onclick="window.NotificationCenter.viewRequest('${reqId}')">🔍 View Request</button>` : '';
      const readBtn = !n.is_read ? `<button class="notif-act-btn" onclick="window.NotificationCenter.markRead('${n.id}')">Mark Read</button>` : '';

      return `
        <div class="notif-item ${!n.is_read ? 'unread' : ''}">
          <div class="notif-icon ${iconClass}">${icon}</div>
          <div class="notif-content">
            <div class="notif-title">${escapeHtml(n.title)}</div>
            <div class="notif-msg">${escapeHtml(n.message)}</div>
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
