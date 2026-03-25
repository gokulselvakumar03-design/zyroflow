const API_BASE = 'http://localhost:4000/api';

function getToken() {
  return localStorage.getItem('auth_token');
}

function setAlert(type, message) {
  const alert = document.getElementById('approvals-alert');
  alert.className = `alert alert-${type}`;
  alert.innerText = message;
  alert.classList.remove('d-none');
}

function clearAlert() {
  const alert = document.getElementById('approvals-alert');
  alert.className = 'alert d-none';
  alert.innerText = '';
}

function checkAuth() {
  if (!getToken()) {
    window.location.href = 'login.html';
  }
}

function logout() {
  localStorage.removeItem('auth_token');
  window.location.href = 'login.html';
}

async function fetchPendingApprovals() {
  const token = getToken();
  if (!token) return { success: false, message: 'Not authenticated' };

  try {
    const res = await fetch(`${API_BASE}/pending-approvals`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) return { success: false, message: data.message || 'Unable to fetch pending approvals' };
    return { success: true, data };
  } catch (err) {
    return { success: false, message: err.message || 'Network error' };
  }
}

async function approveRequest(requestId) {
  const token = getToken();
  if (!token) return { success: false, message: 'Not authenticated' };

  try {
    const res = await fetch(`${API_BASE}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ request_id: requestId }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, message: data.message || 'Approve failed' };
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message || 'Network error' };
  }
}

async function rejectRequest(requestId) {
  const token = getToken();
  if (!token) return { success: false, message: 'Not authenticated' };

  try {
    const res = await fetch(`${API_BASE}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ request_id: requestId }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, message: data.message || 'Reject failed' };
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message || 'Network error' };
  }
}

function renderApprovals(data) {
  const tbody = document.querySelector('#approvals-table tbody');
  tbody.innerHTML = '';

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">No pending approvals</td></tr>';
    return;
  }

  data.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.request_id}</td>
      <td>${item.request_type}</td>
      <td>${item.amount}</td>
      <td>${item.description || ''}</td>
      <td><button class="btn btn-sm btn-success" data-action="approve" data-request="${item.request_id}">Approve</button></td>
      <td><button class="btn btn-sm btn-danger" data-action="reject" data-request="${item.request_id}">Reject</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadApprovals() {
  clearAlert();
  const result = await fetchPendingApprovals();
  if (!result.success) {
    setAlert('danger', result.message);
    return;
  }
  renderApprovals(result.data);
}

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('load-approvals').addEventListener('click', loadApprovals);

  document.querySelector('#approvals-table tbody').addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;

    const action = button.getAttribute('data-action');
    const requestId = button.getAttribute('data-request');
    if (!action || !requestId) return;

    let res;
    if (action === 'approve') {
      res = await approveRequest(Number(requestId));
    } else {
      res = await rejectRequest(Number(requestId));
    }

    if (res.success) {
      setAlert('success', `${action === 'approve' ? 'Approved' : 'Rejected'} request ${requestId}`);
      loadApprovals();
    } else {
      setAlert('danger', res.message);
    }
  });

  loadApprovals();
});
