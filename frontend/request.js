const apiBase = 'http://localhost:4000/api';

function getToken() {
  return localStorage.getItem('auth_token');
}

function setMessage(type, text) {
  const alert = document.getElementById('request-alert');
  alert.className = `alert alert-${type}`;
  alert.innerText = text;
  alert.classList.remove('d-none');
}

function checkAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = 'login.html';
  }
}

function logout() {
  localStorage.removeItem('auth_token');
  window.location.href = 'login.html';
}

async function submitRequest(request_type, amount, description) {
  const token = getToken();
  if (!token) {
    setMessage('danger', 'Not authenticated. Please login.');
    return;
  }

  try {
    const response = await fetch(`${apiBase}/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ request_type, amount, description }),
    });

    const data = await response.json();
    if (!response.ok) {
      setMessage('danger', data.message || 'Failed to submit request');
      return;
    }

    setMessage('success', `Request created successfully with id ${data.request_id}`);
    document.getElementById('request-form').reset();
  } catch (err) {
    setMessage('danger', err.message || 'Error connecting to API');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  document.getElementById('logout-btn').addEventListener('click', logout);

  document.getElementById('request-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const request_type = document.getElementById('request_type').value.trim();
    const amount = Number(document.getElementById('amount').value);
    const description = document.getElementById('description').value.trim();
    await submitRequest(request_type, amount, description);
  });
});
