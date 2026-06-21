const API_BASE = window.location.origin + '/api';

function getUserEmail() {
  return localStorage.getItem('userEmail') || '';
}

async function loadProfile() {
  const email = getUserEmail();
  if (!email) return;
  try {
    const res = await fetch(`${API_BASE}/profile?email=${encodeURIComponent(email)}`);
    if (!res.ok) return;
    const user = await res.json();
    document.getElementById('name').value = user.name || '';
    document.getElementById('email').value = user.email || '';
    document.getElementById('role').value = user.role || '';
    document.getElementById('phone').value = user.phone || '';
    document.getElementById('department').value = user.department || '';
    document.getElementById('profile_image').value = user.profile_image || '';
    if (user.profile_image) {
      const avatar = document.getElementById('avatar');
      avatar.style.backgroundImage = `url('${user.profile_image}')`;
      avatar.style.backgroundSize = 'cover';
      avatar.textContent = '';
    } else {
      const avatar = document.getElementById('avatar');
      avatar.textContent = (user.name || 'U').charAt(0).toUpperCase();
    }
  } catch (err) {
    console.error(err);
  }
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
    document.getElementById('msg').textContent = data.success ? 'Profile updated' : (data.message || 'Update failed');
    if (data.user) localStorage.setItem('currentUser', JSON.stringify(data.user));
    setTimeout(() => { document.getElementById('msg').textContent = ''; }, 3000);
  } catch (err) {
    document.getElementById('msg').textContent = 'Network error';
  }
}

async function changePassword() {
  const oldPassword = document.getElementById('oldPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;
  const email = document.getElementById('email').value;
  if (!oldPassword || !newPassword) { document.getElementById('msg').textContent = 'Provide both passwords'; return; }
  if (newPassword !== confirm) { document.getElementById('msg').textContent = 'Passwords do not match'; return; }
  try {
    const res = await fetch(`${API_BASE}/change-password`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, oldPassword, newPassword })
    });
    const data = await res.json();
    document.getElementById('msg').textContent = data.success ? 'Password updated' : (data.message || 'Update failed');
  } catch (err) {
    document.getElementById('msg').textContent = 'Network error';
  }
  setTimeout(() => { document.getElementById('msg').textContent = ''; }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
  loadProfile();
  document.getElementById('saveBtn').addEventListener('click', saveProfile);
  document.getElementById('doChangePwd').addEventListener('click', changePassword);
  document.getElementById('changePwdBtn').addEventListener('click', () => {
    document.getElementById('oldPassword').focus();
  });
});
