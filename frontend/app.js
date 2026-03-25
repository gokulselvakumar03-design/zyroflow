const API_BASE = 'http://localhost:4000/api';

function getToken() {
  return localStorage.getItem('auth_token');
}

function setToken(token) {
  localStorage.setItem('auth_token', token);
}

function logout() {
  localStorage.removeItem('auth_token');
  window.location.href = 'login.html';
}

function checkAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = 'login.html';
  }
}

async function login(email, password) {
  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();
    if (!response.ok) {
      return { success: false, message: data.message || 'Login failed' };
    }

    setToken(data.token);
    localStorage.setItem('user_role', data.role || '');
    localStorage.setItem('user_id', data.userId || '');

    return { success: true };
  } catch (err) {
    return { success: false, message: err.message || 'Login error' };
  }
}

async function submitRequest(request_type, amount, description) {
  const token = getToken();
  if (!token) return { success: false, message: 'Not authenticated' };

  try {
    const response = await fetch(`${API_BASE}/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ request_type, amount, description }),
    });

    const data = await response.json();
    if (!response.ok) return { success: false, message: data.message || 'Submit failed' };

    return { success: true, request_id: data.request_id };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function getPendingApprovals() {
  const token = getToken();
  if (!token) return { success: false, message: 'Not authenticated' };

  try {
    const response = await fetch(`${API_BASE}/pending-approvals`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await response.json();
    if (!response.ok) return { success: false, message: data.message || 'Unable to fetch approvals' };

    return { success: true, data };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function approve(request_id) {
  const token = getToken();
  if (!token) return { success: false, message: 'Not authenticated' };
  try {
    const response = await fetch(`${API_BASE}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ request_id }),
    });
    const data = await response.json();
    if (!response.ok) return { success: false, message: data.message || 'Approve failed' };
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function rejectReq(request_id) {
  const token = getToken();
  if (!token) return { success: false, message: 'Not authenticated' };
  try {
    const response = await fetch(`${API_BASE}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ request_id }),
    });
    const data = await response.json();
    if (!response.ok) return { success: false, message: data.message || 'Reject failed' };
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function getTrack(requestId) {
  const token = getToken();
  if (!token) return { success: false, message: 'Not authenticated' };

  try {
    const response = await fetch(`${API_BASE}/track/${requestId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await response.json();
    if (!response.ok) return { success: false, message: data.message || 'Track request failed' };

    return { success: true, workflow: data.workflow };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function createRule(request_type, min_amount, max_amount, approvers) {
  const token = getToken();
  if (!token) return { success: false, message: 'Not authenticated' };

  try {
    const response = await fetch(`${API_BASE}/rules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ request_type, min_amount, max_amount, approvers }),
    });
    const data = await response.json();
    if (!response.ok) return { success: false, message: data.message || 'Create rule failed' };
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
