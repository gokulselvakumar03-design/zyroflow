const API_BASE = 'http://localhost:4000/api';
const PROFILE_IMAGE_STORAGE_KEY = 'profileImageDataURL';

function getAuthToken() {
  return localStorage.getItem('authToken') || localStorage.getItem('auth_token') || '';
}

function getAuthHeaders() {
  const headers = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function getUserEmail() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  return currentUser?.email || localStorage.getItem('userEmail') || localStorage.getItem('email') || '';
}

function getCurrentUserId() {
  try {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    const candidates = [
      currentUser?.id,
      currentUser?.userId,
      currentUser?.user_id,
      localStorage.getItem('userId'),
      localStorage.getItem('user_id'),
      localStorage.getItem('id')
    ];

    for (const value of candidates) {
      const normalized = String(value || '').trim();
      if (normalized) return normalized;
    }
  } catch (err) {
    console.error(err);
  }

  return '';
}

function getRoleFromSession() {
  try {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    const role = currentUser?.role || localStorage.getItem('role') || localStorage.getItem('userRole') || localStorage.getItem('user_role') || '';
    return String(role || '').trim().toLowerCase();
  } catch (err) {
    return '';
  }
}

function getDashboardUrlForRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  const dashboardMap = {
    admin: 'admin-dashboard.html',
    employee: 'employee.html',
    accounts: 'accounts-dashboard.html',
    manager: 'manager-dashboard.html',
    cfo: 'cfo-dashboard.html',
    md: 'md-dashboard.html',
    'managing director': 'md-dashboard.html',
    'managing_director': 'md-dashboard.html',
    'm.d.': 'md-dashboard.html'
  };

  return dashboardMap[normalized] || 'login.html';
}

function updateBackToDashboardLink() {
  const link = document.getElementById('backToDashboardBtn');
  if (!link) return;

  const token = getAuthToken();
  const role = getRoleFromSession();
  const dashboardUrl = token || role ? getDashboardUrlForRole(role) : 'login.html';
  link.href = dashboardUrl;

  link.addEventListener('click', (event) => {
    if (!token && !role) {
      event.preventDefault();
      window.location.href = 'login.html';
    }
  });
}

function getProfileImageStorageKey(userId = getCurrentUserId()) {
  return userId ? `profileImage_${userId}` : PROFILE_IMAGE_STORAGE_KEY;
}

function getStoredProfileImage(userId = getCurrentUserId()) {
  return localStorage.getItem(getProfileImageStorageKey(userId)) || '';
}

function saveStoredProfileImage(dataUrl, userId = getCurrentUserId()) {
  const key = getProfileImageStorageKey(userId);
  if (dataUrl) {
    localStorage.setItem(key, dataUrl);
  } else {
    localStorage.removeItem(key);
  }
}

function persistCurrentUserProfileImage(profileImage) {
  try {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (currentUser) {
      currentUser.profile_image = profileImage || '';
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
    }
  } catch (err) {
    console.error(err);
  }
}

async function syncProfileImageToServer(profileImage) {
  const email = getUserEmail();
  if (!email) return;

  try {
    await fetch(`${API_BASE}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ profile_image: profileImage || '' })
    });
  } catch (err) {
    console.error(err);
  }
}

function handleProfileImageSelection(event) {
  const file = event.target?.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    alert('Selected file must be an image.');
    event.target.value = '';
    return;
  }

  const maxBytes = 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    alert('Selected image must be 5 MB or smaller.');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result;
    if (!dataUrl || typeof dataUrl !== 'string') {
      alert('Unable to load the selected image.');
      return;
    }
    saveStoredProfileImage(dataUrl);
    persistCurrentUserProfileImage(dataUrl);
    updateAvatar({ profile_image: dataUrl, name: document.getElementById('name').value });
    await syncProfileImageToServer(dataUrl);
  };
  reader.readAsDataURL(file);
}

function triggerProfileImageUpload(event) {
  event.preventDefault();
  const input = document.getElementById('profileImageInput');
  input?.click();
}

async function removeProfilePicture(event) {
  event.preventDefault();
  const userId = getCurrentUserId();
  if (!userId) {
    setProfileMessage('No active user found to remove the profile picture.', 'err');
    return;
  }

  localStorage.removeItem(getProfileImageStorageKey(userId));
  persistCurrentUserProfileImage('');
  updateAvatar({ profile_image: '', name: document.getElementById('name').value });
  await syncProfileImageToServer('');
  setProfileMessage('Profile picture removed.', 'ok');
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not Available';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function setProfileMessage(text, type = 'ok') {
  const msg = document.getElementById('profileMsg');
  if (!msg) return;
  msg.textContent = text;
  msg.className = `profile-message ${type}`;
  msg.classList.remove('hidden');
  setTimeout(() => { msg.classList.add('hidden'); }, 3200);
}

function updateAvatar(user) {
  const avatar = document.getElementById('avatar');
  if (!avatar) return;

  avatar.style.backgroundImage = '';
  avatar.innerHTML = '';

  if (user.profile_image) {
    const img = document.createElement('img');
    img.src = user.profile_image;
    img.alt = 'Profile';
    avatar.appendChild(img);
    return;
  }

  const name = String(user.name || user.email || 'U').trim();
  avatar.textContent = name.charAt(0).toUpperCase();
}

async function loadProfile() {
  const email = getUserEmail();
  const fallbackUser = (() => {
    try {
      return JSON.parse(localStorage.getItem('currentUser') || '{}');
    } catch (err) {
      return {};
    }
  })();

  let user = fallbackUser;

  if (email) {
    try {
      const res = await fetch(`${API_BASE}/profile`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        user = await res.json();
      } else {
        console.warn('Profile fetch failed:', res.status);
      }
    } catch (err) {
      console.error(err);
    }
  }

  const name = user.name || fallbackUser.name || '';
  const role = user.role || fallbackUser.role || '';
  const department = user.department || fallbackUser.department || '';
  const phone = user.phone || fallbackUser.phone || '';
  const emailValue = user.email || fallbackUser.email || email;
  const currentUserId = getCurrentUserId() || user.id || fallbackUser.id || user.userId || fallbackUser.userId || user.user_id || fallbackUser.user_id || '';
  const storedImage = getStoredProfileImage(currentUserId);
  const profileImage = storedImage || user.profile_image || fallbackUser.profile_image || '';
  const createdAt = user.createdAt || user.created_at || fallbackUser.createdAt || fallbackUser.created_at || fallbackUser.accountCreated || '';
  const lastLogin = user.lastLogin || user.last_login || fallbackUser.lastLogin || fallbackUser.last_login || fallbackUser.lastActivity || '';
  const status = user.status || fallbackUser.status || 'Active';

  document.getElementById('name').value = name;
  document.getElementById('email').value = emailValue;
  document.getElementById('role').value = role;
  document.getElementById('department').value = department;
  document.getElementById('phone').value = phone;
  document.getElementById('profileNamePreview').textContent = name || 'User Profile';
  document.getElementById('profileRoleBadge').textContent = role || 'User';
  document.getElementById('accountCreated').textContent = createdAt ? formatTimestamp(createdAt) : 'Not Available';
  document.getElementById('lastLogin').textContent = lastLogin ? formatTimestamp(lastLogin) : 'Not Available';
  document.getElementById('accountRole').textContent = role || 'Not Available';
  document.getElementById('accountStatus').textContent = status || 'Active';

  updateAvatar({ profile_image: profileImage, name });
}

async function saveProfile() {
  const currentUserId = getCurrentUserId();
  const payload = {
    name: document.getElementById('name').value,
    phone: document.getElementById('phone').value,
    department: document.getElementById('department').value,
    profile_image: getStoredProfileImage(currentUserId)
  };

  try {
    const res = await fetch(`${API_BASE}/profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      setProfileMessage('Profile updated successfully.', 'ok');
      if (data.user) {
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        document.getElementById('profileNamePreview').textContent = data.user.name || payload.name;
        document.getElementById('profileRoleBadge').textContent = data.user.role || document.getElementById('role').value;
        updateAvatar({ profile_image: data.user.profile_image || payload.profile_image, name: data.user.name || payload.name });
      }
    } else {
      setProfileMessage(data.message || 'Update failed.', 'err');
    }
  } catch (err) {
    setProfileMessage('Network error while saving profile.', 'err');
  }
}

function evaluatePasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}

function updatePasswordStrength() {
  const input = document.getElementById('newPassword');
  const fill = document.getElementById('strengthFill');
  const label = document.getElementById('strengthText');
  if (!input || !fill || !label) return;

  const strength = evaluatePasswordStrength(input.value || '');
  const percent = Math.min(100, (strength / 5) * 100);
  fill.style.width = `${percent}%`;

  if (strength <= 1) {
    label.textContent = 'Very weak';
    fill.style.background = 'linear-gradient(90deg, #ef4444, #f97316)';
  } else if (strength === 2) {
    label.textContent = 'Weak';
    fill.style.background = 'linear-gradient(90deg, #f97316, #fb923c)';
  } else if (strength === 3) {
    label.textContent = 'Fair';
    fill.style.background = 'linear-gradient(90deg, #facc15, #38bdf8)';
  } else if (strength === 4) {
    label.textContent = 'Strong';
    fill.style.background = 'linear-gradient(90deg, #22c55e, #60e8ff)';
  } else {
    label.textContent = 'Very strong';
    fill.style.background = 'linear-gradient(90deg, #0ea5e9, #60e8ff)';
  }
}

async function changePassword(event) {
  event.preventDefault();
  const oldPassword = document.getElementById('oldPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;

  if (!oldPassword || !newPassword || !confirm) {
    setProfileMessage('Please fill in the current password, new password, and confirmation.', 'err');
    return;
  }
  if (!newPassword.trim()) {
    setProfileMessage('New password is required.', 'err');
    return;
  }
  if (newPassword !== confirm) {
    setProfileMessage('Passwords do not match.', 'err');
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
      setProfileMessage(data.message || 'Password updated successfully.', 'ok');
      document.getElementById('oldPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
      updatePasswordStrength();
    } else {
      setProfileMessage(data.message || 'Password update failed.', 'err');
    }
  } catch (err) {
    setProfileMessage('Network error while changing password.', 'err');
  }
}

function focusSecuritySection() {
  const target = document.getElementById('oldPassword');
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.focus();
}

document.addEventListener('DOMContentLoaded', () => {
  updateBackToDashboardLink();
  loadProfile();
  document.getElementById('saveBtn').addEventListener('click', saveProfile);
  document.getElementById('doChangePwd').addEventListener('click', changePassword);
  document.getElementById('changePwdBtn').addEventListener('click', focusSecuritySection);
  document.getElementById('changePictureBtn').addEventListener('click', triggerProfileImageUpload);
  document.getElementById('removePictureBtn').addEventListener('click', removeProfilePicture);
  document.getElementById('profileImageInput').addEventListener('change', handleProfileImageSelection);
  document.getElementById('newPassword').addEventListener('input', updatePasswordStrength);
});
