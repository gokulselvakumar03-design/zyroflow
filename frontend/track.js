
const API_BASE = 'http://localhost:4000/api';

function getToken() {
  return localStorage.getItem('auth_token');
}

function setAlert(type, message) {
  const alert = document.getElementById('track-alert');
  alert.className = `alert alert-${type}`;
  alert.innerText = message;
  alert.classList.remove('d-none');
}

function clearAlert() {
  const alert = document.getElementById('track-alert');
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

function getStatusDisplay(status) {
  switch (status.toLowerCase()) {
    case 'approved':
      return { icon: '✓', text: 'Approved', class: 'text-success' };
    case 'pending':
      return { icon: '⏳', text: 'Pending', class: 'text-warning' };
    case 'waiting':
      return { icon: '', text: 'Waiting', class: 'text-secondary' };
    case 'rejected':
      return { icon: '✗', text: 'Rejected', class: 'text-danger' };
    default:
      return { icon: '', text: status, class: 'text-muted' };
  }
}

async function fetchTrack(requestId) {
  const token = getToken();
  if (!token) {
    return { success: false, missingToken: true, message: 'Not authenticated' };
  }

  try {
    const response = await fetch(`${API_BASE}/track/${requestId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await response.json();
    if (!response.ok) {
      return { success: false, message: data.message || 'Error fetching track details' };
    }

    return { success: true, workflow: data.workflow || [] };
  } catch (err) {
    return { success: false, message: err.message || 'Network error' };
  }
}

function renderWorkflow(workflow) {
  const container = document.getElementById('workflow');
  container.innerHTML = '';

  if (!Array.isArray(workflow) || workflow.length === 0) {
    container.innerHTML = '<div class="text-muted">No workflow found</div>';
    return;
  }

  workflow.forEach((item) => {
    const statusMeta = getStatusDisplay(item.status);

    const card = document.createElement('div');
    card.className = 'card mb-3';

    const body = document.createElement('div');
    body.className = 'card-body';

    const roleEl = document.createElement('h5');
    roleEl.className = 'card-title';
    roleEl.innerText = item.approver_role;

    const statusEl = document.createElement('p');
    statusEl.className = `card-text ${statusMeta.class}`;
    statusEl.innerHTML = `<strong>${statusMeta.icon}</strong> ${statusMeta.text}`;

    body.appendChild(roleEl);
    body.appendChild(statusEl);

    if (item.status.toLowerCase() === 'approved' && item.approval_time) {
      const timeEl = document.createElement('p');
      timeEl.className = 'card-text text-muted';
      timeEl.innerText = `(${item.approval_time})`;
      body.appendChild(timeEl);
    }

    card.appendChild(body);
    container.appendChild(card);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  document.getElementById('logout-btn').addEventListener('click', logout);

  document.getElementById('track-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAlert();

    const requestId = document.getElementById('request_id').value.trim();
    if (!requestId) {
      setAlert('warning', 'Request ID cannot be empty.');
      document.getElementById('workflow').innerHTML = '';
      return;
    }

    const result = await fetchTrack(requestId);
    if (result.missingToken) {
      window.location.href = 'login.html';
      return;
    }

    if (!result.success) {
      setAlert('danger', result.message);
      document.getElementById('workflow').innerHTML = '';
      return;
    }

    renderWorkflow(result.workflow);
  });
});
