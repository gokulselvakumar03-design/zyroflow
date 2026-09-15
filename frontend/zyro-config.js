/**
 * ZyroFlow Universal Environment & API Configuration
 * Supports both:
 * 1. Static dev servers (e.g. VS Code Live Server on port 5500, 3000, 5173) -> points to backend on port 4000
 * 2. Integrated Node.js server (localhost:4000) & Production HTTPS domain -> uses relative paths
 * 3. Transparent Demo-Session Propagation across all requests
 */
(function () {
    const isBrowser = typeof window !== 'undefined' && window.location;
    let backendOrigin = '';

    if (isBrowser) {
        const { hostname, port } = window.location;
        if ((hostname === 'localhost' || hostname === '127.0.0.1') && port && port !== '4000') {
            backendOrigin = `http://${hostname}:4000`;
        }
    }

    const apiBase = `${backendOrigin}/api`;
    const requestsBase = `${backendOrigin}/requests`;

    function getCookie(name) {
        if (typeof document === 'undefined') return null;
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? decodeURIComponent(match[2]) : null;
    }

    function setCookie(name, value, days = 30) {
        if (typeof document === 'undefined') return;
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${encodeURIComponent(value)}; expires=${date.toUTCString()}; path=/; SameSite=Lax`;
    }

    function getDemoSessionId() {
        if (typeof localStorage !== 'undefined') {
            const stored = localStorage.getItem('zyro_demo_session');
            if (stored) return stored;
        }
        return getCookie('zyro_demo_session');
    }

    function setDemoSessionId(sessionId) {
        if (!sessionId) return;
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('zyro_demo_session', sessionId);
        }
        setCookie('zyro_demo_session', sessionId, 30);
    }

    // Intercept native fetch to seamlessly pass cookies and demo-session headers
    if (typeof window !== 'undefined' && window.fetch) {
        const originalFetch = window.fetch;
        window.fetch = async function (resource, options = {}) {
            options = options || {};
            options.credentials = options.credentials || 'include';

            const demoSession = getDemoSessionId();
            if (demoSession) {
                options.headers = options.headers || {};
                if (options.headers instanceof Headers) {
                    if (!options.headers.has('X-Demo-Session-Id')) {
                        options.headers.set('X-Demo-Session-Id', demoSession);
                    }
                } else if (Array.isArray(options.headers)) {
                    options.headers.push(['X-Demo-Session-Id', demoSession]);
                } else {
                    options.headers['X-Demo-Session-Id'] = options.headers['X-Demo-Session-Id'] || demoSession;
                }
            }

            const response = await originalFetch(resource, options);

            const sessionHeader = response.headers.get('X-Demo-Session-Id');
            if (sessionHeader) {
                setDemoSessionId(sessionHeader);
            }

            return response;
        };
    }

    window.ZYRO_CONFIG = {
        backendOrigin,
        apiBase,
        requestsBase,
        getApiUrl: (endpoint) => `${apiBase}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`,
        getRequestsUrl: (endpoint = '') => `${requestsBase}${endpoint ? (endpoint.startsWith('/') ? endpoint : '/' + endpoint) : ''}`,
        getDemoSessionId,
        setDemoSessionId
    };

    window.API_BASE = apiBase;
    window.REQUESTS_API_URL = requestsBase;
    window.API_BASE_URL = backendOrigin;
})();
