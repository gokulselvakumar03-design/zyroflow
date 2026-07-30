/**
 * ZyroFlow Profile Settings Redirect Helper
 * Redirects legacy profile.html calls to the role dashboard with the right-side Settings Drawer opened.
 */

(function () {
  try {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    const role = (currentUser.role || localStorage.getItem('userRole') || localStorage.getItem('role') || 'employee').toString().toLowerCase().trim();
    
    const dashboardMap = {
      admin: 'admin-dashboard.html',
      employee: 'employee.html',
      accounts: 'accounts-dashboard.html',
      manager: 'manager-dashboard.html',
      cfo: 'cfo-dashboard.html',
      md: 'md-dashboard.html'
    };

    const targetDashboard = dashboardMap[role] || 'employee.html';
    if (window.location.pathname.endsWith('profile.html')) {
      window.location.replace(targetDashboard + '?openSettings=true');
    }
  } catch (e) {
    if (window.location.pathname.endsWith('profile.html')) {
      window.location.replace('employee.html?openSettings=true');
    }
  }
})();
