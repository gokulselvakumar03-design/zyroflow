const API_BASE = window.location.origin + '/api';
const PROFILE_IMAGE_STORAGE_KEY = 'profileImageDataURL';

function getUserEmail() {
  return localStorage.getItem('userEmail') || '';
}

function getStoredProfileImage() {
  return localStorage.getItem(PROFILE_IMAGE_STORAGE_KEY) || '';
}

function saveStoredProfileImage(dataUrl) {
  if (dataUrl) {
    localStorage.setItem(PROFILE_IMAGE_STORAGE_KEY, dataUrl);
  } else {
    localStorage.removeItem(PROFILE_IMAGE_STORAGE_KEY);
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
  reader.onload = () => {
    const dataUrl = reader.result;
    if (!dataUrl || typeof dataUrl !== 'string') {
      alert('Unable to load the selected image.');
      return;
    }
    saveStoredProfileImage(dataUrl);
    updateAvatar({ profile_image: dataUrl, name: document.getElementById('name').value });
  };
  reader.readAsDataURL(file);
}

function triggerProfileImageUpload(event) {
  event.preventDefault();
  const input = document.getElementById('profileImageInput');
  input?.click();
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
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
  if (!email) return;

  let user = null;
  try {
    const res = await fetch(`${API_BASE}/profile?email=${encodeURIComponent(email)}`);
    if (res.ok) user = await res.json();
  } catch (err) {
    console.error(err);
  }

  if (!user) {
    try {
      user = JSON.parse(localStorage.getItem('currentUser') || '{}');
    } catch (err) {
      user = {};
    }
  }

  const name = user.name || '';
  const role = user.role || '';
  const department = user.department || '';
  const phone = user.phone || '';
  const emailValue = user.email || email;
  const storedImage = getStoredProfileImage();
  const profileImage = storedImage || user.profile_image || '';
  const createdAt = user.createdAt || user.created_at || user.accountCreated || '';
  const lastLogin = user.lastLogin || user.last_login || user.lastActivity || '';
  const status = user.status || 'Active';

  document.getElementById('name').value = name;
  document.getElementById('email').value = emailValue;
  document.getElementById('role').value = role;
  document.getElementById('department').value = department;
  document.getElementById('phone').value = phone;
  document.getElementById('profile_image').value = profileImage;
  document.getElementById('profileNamePreview').textContent = name || 'User Profile';
  document.getElementById('profileRoleBadge').textContent = role || 'User';
  document.getElementById('accountCreated').textContent = createdAt ? formatTimestamp(createdAt) : 'Unknown';
  document.getElementById('lastLogin').textContent = lastLogin ? formatTimestamp(lastLogin) : 'Unknown';
  document.getElementById('accountRole').textContent = role || 'Unknown';
  document.getElementById('accountStatus').textContent = status;

  updateAvatar({ profile_image: profileImage, name });
}

async function saveProfile() {
  const payload = {
    email: document.getElementById('email').value,
    name: document.getElementById('name').value,
    phone: document.getElementById('phone').value,
    department: document.getElementById('department').value,
    profile_image: document.getElementById('profile_image').value
  };

  try {
    const res = await fetch(`${API_BASE}/profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
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
  const email = document.getElementById('email').value;

  if (!oldPassword || !newPassword) {
    setProfileMessage('Provide both current and new password.', 'err');
    return;
  }
  if (newPassword !== confirm) {
    setProfileMessage('Passwords do not match.', 'err');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/change-password`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, oldPassword, newPassword })
    });
    const data = await res.json();
    if (data.success) {
      setProfileMessage('Password updated successfully.', 'ok');
      document.getElementById('oldPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
      updatePasswordStrength();
    } else {
      setProfileMessage(data.message || 'Update failed.', 'err');
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
  loadProfile();
  document.getElementById('saveBtn').addEventListener('click', saveProfile);
  document.getElementById('doChangePwd').addEventListener('click', changePassword);
  document.getElementById('changePwdBtn').addEventListener('click', focusSecuritySection);
  document.getElementById('changePictureBtn').addEventListener('click', triggerProfileImageUpload);
  document.getElementById('profileImageInput').addEventListener('change', handleProfileImageSelection);
  document.getElementById('newPassword').addEventListener('input', updatePasswordStrength);
});
