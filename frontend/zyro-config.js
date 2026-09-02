/**
 * ZyroFlow Universal Environment & API Configuration
 * Supports both:
 * 1. Static dev servers (e.g. VS Code Live Server on port 5500, 3000, 5173) -> points to backend on port 4000
 * 2. Integrated Node.js server (localhost:4000) & Production HTTPS domain -> uses relative paths
 */
(function () {
    const isBrowser = typeof window !== 'undefined' && window.location;
    let backendOrigin = '';

    if (isBrowser) {
        const { hostname, port, origin } = window.location;
        // If loaded via Live Server / Vite / Webpack dev server (e.g. port 5500, 3000, 5173, 8080)
        if ((hostname === 'localhost' || hostname === '127.0.0.1') && port && port !== '4000') {
            backendOrigin = `http://${hostname}:4000`;
        }
    }

    const apiBase = `${backendOrigin}/api`;
    const requestsBase = `${backendOrigin}/requests`;

    window.ZYRO_CONFIG = {
        backendOrigin,
        apiBase,
        requestsBase,
        getApiUrl: (endpoint) => `${apiBase}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`,
        getRequestsUrl: (endpoint = '') => `${requestsBase}${endpoint ? (endpoint.startsWith('/') ? endpoint : '/' + endpoint) : ''}`
    };

    window.API_BASE = apiBase;
    window.REQUESTS_API_URL = requestsBase;
    window.API_BASE_URL = backendOrigin;
})();
