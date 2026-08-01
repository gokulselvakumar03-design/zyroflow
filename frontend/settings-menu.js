/**
 * ZyroFlow Centralized Settings Drawer & Profile Controller (Dark Theme Default)
 * Shared settings component across all ZyroFlow dashboards.
 */

(function () {
  console.log('[ZyroSettings] Centralized Settings Controller initialized.');

  const API_BASE = typeof window.API_BASE !== 'undefined' ? window.API_BASE : 'http://localhost:4000/api';
  let currentUserData = null;

  // Initialize Theme from localStorage (default: light)
  applyThemeFromStorage();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initZyroSettings);
  } else {
    initZyroSettings();
  }

  function getAuthToken() {
    return localStorage.getItem('authToken') || localStorage.getItem('auth_token') || '';
  }

  function getAuthHeaders() {
    const headers = {};
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  function getSavedUser() {
    try {
      return JSON.parse(localStorage.getItem('currentUser') || 'null') || {};
    } catch (e) {
      return {};
    }
  }

  function getUserId() {
    const user = getSavedUser();
    return user.id || user.userId || user.user_id || localStorage.getItem('userId') || localStorage.getItem('user_id') || '';
  }

  function getStoredProfileImage() {
    const userId = getUserId();
    const key = userId ? `profileImage_${userId}` : 'profileImageDataURL';
    return localStorage.getItem(key) || '';
  }

  function saveStoredProfileImage(dataUrl) {
    const userId = getUserId();
    const key = userId ? `profileImage_${userId}` : 'profileImageDataURL';
    if (dataUrl) {
      localStorage.setItem(key, dataUrl);
    } else {
      localStorage.removeItem(key);
    }
  }

  function applyThemeFromStorage() {
    const theme = localStorage.getItem("theme") || "light";
    if (theme === "dark") {
      if (document.body) {
        document.body.classList.remove("light-theme");
        document.body.classList.add("dark-theme");
      }
    } else {
      if (document.body) {
        document.body.classList.remove("dark-theme");
        document.body.classList.add("light-theme");
      }
    }
  }

  function handleThemeChange(selectedTheme) {
    if (selectedTheme === "dark") {
      localStorage.setItem("theme", "dark");
      if (document.body) {
        document.body.classList.remove("light-theme");
        document.body.classList.add("dark-theme");
      }
    } else {
      localStorage.setItem("theme", "light");
      if (document.body) {
        document.body.classList.remove("dark-theme");
        document.body.classList.add("light-theme");
      }
    }
    if (typeof window.updateChartColors === 'function') {
      window.updateChartColors(selectedTheme);
    }
  }

  function initZyroSettings() {
    applyThemeFromStorage();
    injectSettingsDrawerDOM();
    setupHeaderSettingsButton();
    setupGlobalEventListeners();
    loadProfileData();

    // Open settings drawer automatically if query param present
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('openSettings') === 'true') {
      setTimeout(() => openSettingsDrawer(), 300);
    }
  }

  function setupHeaderSettingsButton() {
    const allSettingsBtns = document.querySelectorAll('#zyroSettingsBtn, .settings-btn, [data-action="settings"]');
    allSettingsBtns.forEach(btn => {
      btn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        openSettingsDrawer();
      };
    });
  }

  function setupGlobalEventListeners() {
    document.addEventListener('click', function (e) {
      const trigger = e.target.closest('#zyroSettingsBtn, .settings-btn, [data-action="settings"]');
      if (trigger) {
        e.preventDefault();
        e.stopPropagation();
        openSettingsDrawer();
        return;
      }

      const drawer = document.getElementById('zyroSettingsDrawer');
      const overlay = document.getElementById('zyroSettingsOverlay');

      if (drawer && drawer.classList.contains('open')) {
        if (!drawer.contains(e.target) && (!overlay || overlay.contains(e.target))) {
          closeSettingsDrawer();
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      const drawer = document.getElementById('zyroSettingsDrawer');
      if (e.key === 'Escape' && drawer && drawer.classList.contains('open')) {
        closeSettingsDrawer();
      }
    });
  }

  function injectSettingsDrawerDOM() {
    if (document.getElementById('zyroSettingsDrawer')) return;

    const overlay = document.createElement('div');
    overlay.id = 'zyroSettingsOverlay';
    overlay.className = 'zyro-settings-overlay';
    overlay.addEventListener('click', () => closeSettingsDrawer());

    const notifApproval = localStorage.getItem('zyro_notif_approval') !== 'false';
    const notifPayment = localStorage.getItem('zyro_notif_payment') !== 'false';
    const notifBrowser = localStorage.getItem('zyro_notif_browser') === 'true';

    const drawer = document.createElement('div');
    drawer.id = 'zyroSettingsDrawer';
    drawer.className = 'zyro-settings-drawer';
    drawer.innerHTML = `
      <div class="zyro-drawer-header">
        <div class="zyro-drawer-title-box">
          <div class="zyro-drawer-icon">⚙️</div>
          <div>
            <h3 class="zyro-drawer-title">Settings</h3>
            <div class="zyro-drawer-subtitle">Manage preferences & account details</div>
          </div>
        </div>
        <button type="button" class="zyro-drawer-close" id="zyroDrawerCloseBtn" title="Close Settings">✕</button>
      </div>

      <div class="zyro-drawer-tabs">
        <button type="button" class="zyro-tab-btn active" data-tab="profile">👤 My Profile</button>
        <button type="button" class="zyro-tab-btn" data-tab="security">🔐 Security</button>
        <button type="button" class="zyro-tab-btn" data-tab="notifications">🔔 Notifications</button>
        <button type="button" class="zyro-tab-btn" data-tab="theme">🎨 Theme</button>
      </div>

      <div class="zyro-drawer-body">
        <div id="zyroDrawerMsg" class="zyro-msg-box"></div>

        <!-- 👤 MY PROFILE TAB -->
        <div class="zyro-tab-content active" id="zyroTab-profile">
          <div class="zyro-profile-card">
            <div class="zyro-avatar-wrapper" id="zyroProfileAvatarWrap">
              <div class="zyro-avatar-fallback" id="zyroProfileAvatarFallback">U</div>
            </div>
            <div class="zyro-user-name" id="zyroProfileNameView">User Name</div>
            <div class="zyro-user-role" id="zyroProfileRoleBadge">Employee</div>
            
            <div class="zyro-avatar-edit-actions">
              <button type="button" class="zyro-sm-btn" id="zyroChangePicBtn">📷 Change Photo</button>
              <button type="button" class="zyro-sm-btn" id="zyroRemovePicBtn">🗑️ Remove</button>
            </div>
            <input type="file" id="zyroFileInput" accept="image/*" style="display:none;" />
          </div>

          <form id="zyroMyProfileForm">
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:12px;">
              <div class="zyro-form-group" style="margin-bottom:0;">
                <label class="zyro-form-label">Employee ID</label>
                <input type="text" class="zyro-input" id="zyroProfEmpId" readonly style="opacity:0.75; cursor:not-allowed;" />
              </div>
              <div class="zyro-form-group" style="margin-bottom:0;">
                <label class="zyro-form-label">Role</label>
                <input type="text" class="zyro-input" id="zyroProfRole" readonly style="opacity:0.75; cursor:not-allowed;" />
              </div>
            </div>

            <div class="zyro-form-group">
              <label class="zyro-form-label">Full Name</label>
              <input type="text" class="zyro-input" id="zyroProfEditName" required />
            </div>

            <div class="zyro-form-group">
              <label class="zyro-form-label">Email Address</label>
              <input type="email" class="zyro-input" id="zyroProfEditEmail" placeholder="user@zyroflow.com" />
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
              <div class="zyro-form-group">
                <label class="zyro-form-label">Phone Number</label>
                <input type="text" class="zyro-input" id="zyroProfEditPhone" placeholder="+1 555-0199" />
              </div>
              <div class="zyro-form-group">
                <label class="zyro-form-label">Department</label>
                <input type="text" class="zyro-input" id="zyroProfEditDept" placeholder="Department" />
              </div>
            </div>

            <button type="submit" class="zyro-btn-primary" id="zyroSaveMyProfileBtn" style="margin-top:8px;">
              💾 Save Changes
            </button>
          </form>
        </div>

        <!-- 🔐 SECURITY TAB -->
        <div class="zyro-tab-content" id="zyroTab-security">
          <div style="font-weight:700; margin-bottom: 6px; color:var(--text-primary);">Change Password</div>
          <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px;">
            Update your account password. Use at least 8 characters with letters, numbers & symbols.
          </div>
          <form id="zyroChangePwdForm">
            <div class="zyro-form-group">
              <label class="zyro-form-label">Current Password</label>
              <input type="password" class="zyro-input" id="zyroOldPassword" placeholder="Enter current password" required />
            </div>
            <div class="zyro-form-group">
              <label class="zyro-form-label">New Password</label>
              <input type="password" class="zyro-input" id="zyroNewPassword" placeholder="Enter new password" required />
              <div class="zyro-strength-container">
                <div class="zyro-strength-track">
                  <div class="zyro-strength-bar" id="zyroStrengthBar"></div>
                </div>
                <div class="zyro-strength-text" id="zyroStrengthText">Password strength</div>
              </div>
            </div>
            <div class="zyro-form-group">
              <label class="zyro-form-label">Confirm New Password</label>
              <input type="password" class="zyro-input" id="zyroConfirmPassword" placeholder="Re-enter new password" required />
            </div>
            <button type="submit" class="zyro-btn-primary" id="zyroUpdatePwdBtn">
              🔐 Update Password
            </button>
          </form>
        </div>

        <!-- 🔔 NOTIFICATIONS TAB -->
        <div class="zyro-tab-content" id="zyroTab-notifications">
          <div style="font-weight:700; margin-bottom: 6px; color:var(--text-primary);">Notification Preferences</div>
          <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px;">
            Configure automated alerts for request approvals and status changes.
          </div>
          <div style="display:flex; flex-direction:column; gap:12px;">
            <label class="dropdown-checkbox-label" style="padding:10px; background:var(--input-bg); border-radius:10px; border:1px solid var(--border);">
              <div>
                <div style="font-weight:700; color:var(--text-primary);">• Approval Alerts</div>
                <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:2px;">Get notified when your request is reviewed.</div>
              </div>
              <span class="zyro-switch">
                <input type="checkbox" id="zyroNotifApproval" ${notifApproval ? 'checked' : ''}>
                <span class="zyro-slider"></span>
              </span>
            </label>

            <label class="dropdown-checkbox-label" style="padding:10px; background:var(--input-bg); border-radius:10px; border:1px solid var(--border);">
              <div>
                <div style="font-weight:700; color:var(--text-primary);">• Payment Verification Alerts</div>
                <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:2px;">Get alerts when Accounts verifies payment.</div>
              </div>
              <span class="zyro-switch">
                <input type="checkbox" id="zyroNotifPayment" ${notifPayment ? 'checked' : ''}>
                <span class="zyro-slider"></span>
              </span>
            </label>

            <label class="dropdown-checkbox-label" style="padding:10px; background:var(--input-bg); border-radius:10px; border:1px solid var(--border);">
              <div>
                <div style="font-weight:700; color:var(--text-primary);">• Browser Notifications</div>
                <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:2px;">Enable desktop pop-up alerts.</div>
              </div>
              <span class="zyro-switch">
                <input type="checkbox" id="zyroNotifBrowser" ${notifBrowser ? 'checked' : ''}>
                <span class="zyro-slider"></span>
              </span>
            </label>
          </div>
        </div>

        <!-- 🎨 THEME TAB -->
        <div class="zyro-tab-content" id="zyroTab-theme">
          <div style="font-weight:700; margin-bottom: 6px; color:var(--text-primary);">Appearance</div>
          <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px;">
            Choose your preferred theme.
          </div>
          <div style="display:flex; flex-direction:column; gap:12px;">
            <label class="zyro-theme-card" style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; background:var(--input-bg); border:1px solid var(--border); border-radius:12px; cursor:pointer;">
              <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:1.2rem;">🌞</span>
                <div>
                  <div style="font-weight:700; color:var(--text-primary);">Light Theme</div>
                  <div style="font-size:0.78rem; color:var(--text-secondary);">Clean enterprise light interface</div>
                </div>
              </div>
              <input type="radio" name="zyro_theme_setting" value="light" id="themeRadioLight" style="width:18px; height:18px; cursor:pointer;" />
            </label>

            <label class="zyro-theme-card" style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; background:var(--input-bg); border:1px solid var(--border); border-radius:12px; cursor:pointer;">
              <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:1.2rem;">🌙</span>
                <div>
                  <div style="font-weight:700; color:var(--text-primary);">Dark Theme</div>
                  <div style="font-size:0.78rem; color:var(--text-secondary);">Sleek enterprise dark interface</div>
                </div>
              </div>
              <input type="radio" name="zyro_theme_setting" value="dark" id="themeRadioDark" style="width:18px; height:18px; cursor:pointer;" />
            </label>
          </div>
        </div>

      </div>

      <div class="zyro-drawer-footer">
        <button type="button" class="zyro-btn-danger" id="zyroFooterLogoutBtn" style="padding:10px;">
          🚪 Logout
        </button>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    // Setup event listeners for drawer UI
    document.getElementById('zyroDrawerCloseBtn').addEventListener('click', closeSettingsDrawer);

    // Tab switching
    const tabBtns = drawer.querySelectorAll('.zyro-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const contents = drawer.querySelectorAll('.zyro-tab-content');
        contents.forEach(c => c.classList.remove('active'));

        const activeContent = document.getElementById(`zyroTab-${targetTab}`);
        if (activeContent) activeContent.classList.add('active');
        hideDrawerMessage();
      });
    });

    // Theme selection listeners
    const themeRadios = drawer.querySelectorAll('input[name="zyro_theme_setting"]');
    themeRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        handleThemeChange(e.target.value);
      });
    });

    // Notification checkboxes
    document.getElementById('zyroNotifApproval').addEventListener('change', (e) => localStorage.setItem('zyro_notif_approval', e.target.checked));
    document.getElementById('zyroNotifPayment').addEventListener('change', (e) => localStorage.setItem('zyro_notif_payment', e.target.checked));
    document.getElementById('zyroNotifBrowser').addEventListener('change', (e) => {
      localStorage.setItem('zyro_notif_browser', e.target.checked);
      if (e.target.checked && window.Notification && Notification.permission !== 'granted') {
        Notification.requestPermission();
      }
    });

    // Password strength & form submit
    const newPwdInput = document.getElementById('zyroNewPassword');
    if (newPwdInput) newPwdInput.addEventListener('input', updatePasswordStrength);

    const pwdForm = document.getElementById('zyroChangePwdForm');
    if (pwdForm) pwdForm.addEventListener('submit', handlePasswordChange);

    const profileForm = document.getElementById('zyroMyProfileForm');
    if (profileForm) profileForm.addEventListener('submit', handleMyProfileSave);

    // Avatar image handlers
    const changePicBtn = document.getElementById('zyroChangePicBtn');
    if (changePicBtn) {
      changePicBtn.addEventListener('click', () => document.getElementById('zyroFileInput').click());
    }
    const fileInput = document.getElementById('zyroFileInput');
    if (fileInput) fileInput.addEventListener('change', handleProfilePicSelect);

    const removePicBtn = document.getElementById('zyroRemovePicBtn');
    if (removePicBtn) removePicBtn.addEventListener('click', handleRemoveProfilePic);

    // Footer Logout
    const footerLogout = document.getElementById('zyroFooterLogoutBtn');
    if (footerLogout) footerLogout.addEventListener('click', performLogout);
  }

  function openSettingsDrawer() {
    let drawer = document.getElementById('zyroSettingsDrawer');
    let overlay = document.getElementById('zyroSettingsOverlay');

    if (!drawer || !overlay) {
      injectSettingsDrawerDOM();
      drawer = document.getElementById('zyroSettingsDrawer');
      overlay = document.getElementById('zyroSettingsOverlay');
    }

    if (drawer && overlay) {
      loadProfileData();
      drawer.classList.add('open');
      overlay.classList.add('visible');

      const currentTheme = localStorage.getItem("theme") || "light";
      const radioLight = document.getElementById('themeRadioLight');
      const radioDark = document.getElementById('themeRadioDark');
      if (radioLight) radioLight.checked = (currentTheme === "light");
      if (radioDark) radioDark.checked = (currentTheme === "dark");
    }
  }

  function closeSettingsDrawer() {
    const drawer = document.getElementById('zyroSettingsDrawer');
    const overlay = document.getElementById('zyroSettingsOverlay');
    if (drawer && overlay) {
      drawer.classList.remove('open');
      overlay.classList.remove('visible');
    }
  }

  function toggleSettingsDrawer() {
    const drawer = document.getElementById('zyroSettingsDrawer');
    if (drawer && drawer.classList.contains('open')) {
      closeSettingsDrawer();
    } else {
      openSettingsDrawer();
    }
  }

  function showDrawerMessage(msg, type = 'ok') {
    const msgBox = document.getElementById('zyroDrawerMsg');
    if (!msgBox) return;
    msgBox.textContent = msg;
    msgBox.className = `zyro-msg-box ${type}`;
    setTimeout(() => {
      msgBox.style.display = 'none';
    }, 3500);
  }

  function hideDrawerMessage() {
    const msgBox = document.getElementById('zyroDrawerMsg');
    if (msgBox) msgBox.style.display = 'none';
  }

  async function loadProfileData() {
    const fallbackUser = getSavedUser();
    let user = fallbackUser;
    const email = fallbackUser.email || localStorage.getItem('userEmail') || localStorage.getItem('email') || '';

    if (email) {
      try {
        const res = await fetch(`${API_BASE}/profile`, { headers: getAuthHeaders() });
        if (res.ok) {
          const apiUser = await res.json();
          if (apiUser && (apiUser.email || apiUser.name)) {
            user = { ...fallbackUser, ...apiUser };
          }
        }
      } catch (err) {
        console.warn('[ZyroSettings] Profile fetch notice:', err);
      }
    }

    currentUserData = user;

    const empId = user.employee_id || user.employeeId || fallbackUser.employee_id || fallbackUser.employeeId || 'EMP001';
    const name = user.name || fallbackUser.name || 'Employee';
    const role = user.role || fallbackUser.role || localStorage.getItem('userRole') || 'Employee';
    const dept = user.department || fallbackUser.department || 'Operations';
    const emailVal = user.email || fallbackUser.email || email || '';
    const phone = user.phone || fallbackUser.phone || '';
    const storedImg = getStoredProfileImage();
    const profileImg = storedImg || user.profile_image || fallbackUser.profile_image || '';

    const profNameView = document.getElementById('zyroProfileNameView');
    if (profNameView) profNameView.textContent = name;

    const profRoleBadge = document.getElementById('zyroProfileRoleBadge');
    if (profRoleBadge) profRoleBadge.textContent = role;

    const profEmpId = document.getElementById('zyroProfEmpId');
    if (profEmpId) profEmpId.value = empId;

    const profRoleInput = document.getElementById('zyroProfRole');
    if (profRoleInput) profRoleInput.value = role;

    const editName = document.getElementById('zyroProfEditName');
    if (editName) editName.value = name;

    const editEmail = document.getElementById('zyroProfEditEmail');
    if (editEmail) editEmail.value = emailVal;

    const editPhone = document.getElementById('zyroProfEditPhone');
    if (editPhone) editPhone.value = phone;

    const editDept = document.getElementById('zyroProfEditDept');
    if (editDept) editDept.value = dept;

    renderAvatarDisplays(profileImg, name);
  }

  function renderAvatarDisplays(profileImg, name) {
    const wrap = document.getElementById('zyroProfileAvatarWrap');
    const fallback = document.getElementById('zyroProfileAvatarFallback');
    if (!wrap || !fallback) return;

    const existingImg = wrap.querySelector('.zyro-avatar-img');
    if (existingImg) existingImg.remove();

    if (profileImg) {
      fallback.style.display = 'none';
      const img = document.createElement('img');
      img.className = 'zyro-avatar-img';
      img.src = profileImg;
      img.alt = name;
      wrap.appendChild(img);
    } else {
      fallback.style.display = 'flex';
      fallback.textContent = (name || 'U').charAt(0).toUpperCase();
    }
  }

  function updatePasswordStrength() {
    const val = document.getElementById('zyroNewPassword').value || '';
    const bar = document.getElementById('zyroStrengthBar');
    const label = document.getElementById('zyroStrengthText');
    if (!bar || !label) return;

    let score = 0;
    if (val.length >= 8) score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[a-z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;

    const pct = Math.min(100, (score / 5) * 100);
    bar.style.width = `${pct}%`;

    if (score <= 1) {
      label.textContent = 'Very weak';
      bar.style.background = 'linear-gradient(90deg, #ef4444, #f97316)';
    } else if (score === 2) {
      label.textContent = 'Weak';
      bar.style.background = 'linear-gradient(90deg, #f97316, #fb923c)';
    } else if (score === 3) {
      label.textContent = 'Fair';
      bar.style.background = 'linear-gradient(90deg, #facc15, #38bdf8)';
    } else if (score === 4) {
      label.textContent = 'Strong';
      bar.style.background = 'linear-gradient(90deg, #22c55e, #60e8ff)';
    } else {
      label.textContent = 'Very strong';
      bar.style.background = 'linear-gradient(90deg, #0ea5e9, #60e8ff)';
    }
  }

  async function handlePasswordChange(e) {
    e.preventDefault();
    const oldPassword = document.getElementById('zyroOldPassword').value;
    const newPassword = document.getElementById('zyroNewPassword').value;
    const confirm = document.getElementById('zyroConfirmPassword').value;

    if (!oldPassword || !newPassword || !confirm) {
      showDrawerMessage('Please complete all password fields.', 'err');
      return;
    }
    if (newPassword !== confirm) {
      showDrawerMessage('New passwords do not match.', 'err');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ oldPassword, newPassword, confirmPassword: confirm })
      });
      const data = await res.json();
      if (data.success) {
        showDrawerMessage(data.message || 'Password updated successfully!', 'ok');
        document.getElementById('zyroOldPassword').value = '';
        document.getElementById('zyroNewPassword').value = '';
        document.getElementById('zyroConfirmPassword').value = '';
        updatePasswordStrength();
      } else {
        showDrawerMessage(data.message || 'Password update failed.', 'err');
      }
    } catch (err) {
      showDrawerMessage('Network error changing password.', 'err');
    }
  }

  async function handleMyProfileSave(e) {
    e.preventDefault();
    const name = document.getElementById('zyroProfEditName').value;
    const email = document.getElementById('zyroProfEditEmail').value;
    const phone = document.getElementById('zyroProfEditPhone').value;
    const department = document.getElementById('zyroProfEditDept').value;
    const profile_image = getStoredProfileImage();

    const payload = { name, email, phone, department, profile_image };

    try {
      const res = await fetch(`${API_BASE}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showDrawerMessage('Profile details saved successfully!', 'ok');
        if (data.user) {
          const merged = { ...getSavedUser(), ...data.user };
          localStorage.setItem('currentUser', JSON.stringify(merged));
        }
        loadProfileData();
      } else {
        showDrawerMessage(data.message || 'Failed to update profile details.', 'err');
      }
    } catch (err) {
      showDrawerMessage('Network error saving details.', 'err');
    }
  }

  function handleProfilePicSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showDrawerMessage('File must be an image.', 'err');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      saveStoredProfileImage(dataUrl);
      renderAvatarDisplays(dataUrl, document.getElementById('zyroProfEditName').value);
      showDrawerMessage('Photo preview updated. Click Save Changes to apply.', 'ok');
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveProfilePic() {
    saveStoredProfileImage('');
    renderAvatarDisplays('', document.getElementById('zyroProfEditName').value);
    showDrawerMessage('Photo removed. Click Save Changes to apply.', 'ok');
  }

  async function fetchAndRenderDrawerDrafts() {
    const container = document.getElementById('zyroDraftsListContainer');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center; padding:16px; color:var(--text-secondary);">Loading drafts...</div>';
    const email = currentUserData?.email || getSavedUser().email || localStorage.getItem('userEmail') || '';

    try {
      const res = await fetch(`${API_BASE}/drafts?email=${encodeURIComponent(email)}`, {
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('Failed to load drafts');

      const data = await res.json();
      const drafts = data.drafts || [];

      if (drafts.length === 0) {
        container.innerHTML = `
          <div style="text-align:center; padding:20px; color:var(--text-secondary); font-size:0.88rem;">
            📄 No saved drafts found.
          </div>
        `;
        return;
      }

      container.innerHTML = drafts.map(d => {
        const payload = d.payload || {};
        const reqType = d.request_type || payload.request_type || 'Draft';
        return `
          <div style="background:var(--input-bg); border:1px solid var(--border); border-radius:12px; padding:12px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <div>
              <div style="font-weight:700; font-size:0.9rem; color:var(--text-primary);">Draft #${d.id} — ${reqType}</div>
              <div style="font-size:0.76rem; color:var(--text-secondary); margin-top:2px;">Saved ${new Date(Number(d.updatedAt || d.createdAt || Date.now())).toLocaleDateString()}</div>
            </div>
            <div style="display:flex; gap:6px;">
              <button type="button" class="zyro-sm-btn" style="background:var(--primary); color:var(--primary-text); border:none;" onclick="ZyroSettings.resumeDraft('${d.id}')">🚀 Resume</button>
              <button type="button" class="zyro-sm-btn" style="background:var(--danger-bg); color:var(--danger); border-color:var(--danger-border);" onclick="ZyroSettings.deleteDraft('${d.id}')">🗑️ Delete</button>
            </div>
          </div>
        `;
      }).join('');

    } catch (err) {
      container.innerHTML = `<div style="text-align:center; padding:14px; color:var(--danger); font-size:0.85rem;">Error loading drafts.</div>`;
    }
  }

  function resumeDraft(draftId) {
    closeSettingsDrawer();
    if (typeof window.continueDraft === 'function') {
      window.continueDraft(draftId);
    } else {
      window.location.href = `employee.html?draftId=${encodeURIComponent(draftId)}`;
    }
  }

  async function deleteDraft(draftId) {
    if (!confirm('Delete this draft?')) return;
    try {
      const res = await fetch(`${API_BASE}/drafts/${draftId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        showDrawerMessage('Draft deleted successfully.', 'ok');
        fetchAndRenderDrawerDrafts();
      } else {
        showDrawerMessage('Unable to delete draft.', 'err');
      }
    } catch (err) {
      showDrawerMessage('Error deleting draft.', 'err');
    }
  }

  function performLogout() {
    console.log('[ZyroSettings] Executing user logout...');
    localStorage.removeItem('authToken');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userRole');
    localStorage.removeItem('user_role');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('email');
    localStorage.removeItem('userId');
    localStorage.removeItem('user_id');
    sessionStorage.clear();

    if (typeof window.logout === 'function') {
      window.logout();
      return;
    }
    window.location.href = 'login.html';
  }

  // Expose global API
  window.ZyroSettings = {
    init: initZyroSettings,
    open: openSettingsDrawer,
    close: closeSettingsDrawer,
    toggle: toggleSettingsDrawer,
    resumeDraft: resumeDraft,
    deleteDraft: deleteDraft,
    logout: performLogout
  };
})();
