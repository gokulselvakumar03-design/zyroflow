const crypto = require('crypto');
const pool = require('../config/db');
const { seedDemoSession, ensureDemoAdmin } = require('../utils/demoSeeder');

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    if (!value) return;
    list[name] = decodeURIComponent(value);
  });
  return list;
}

async function demoSessionMiddleware(req, res, next) {
  if (!pool.isDemoMode) {
    req.demoSessionId = null;
    return next();
  }

  try {
    const cookies = parseCookies(req.headers.cookie);
    let sessionId =
      cookies['zyro_demo_session'] ||
      req.headers['x-demo-session-id'] ||
      req.headers['x-demo-session'] ||
      req.query?.demo_session_id ||
      req.body?.demo_session_id ||
      req.user?.demo_session_id;

    if (sessionId && (sessionId === 'undefined' || sessionId === 'null' || String(sessionId).trim() === '')) {
      sessionId = null;
    }

    if (!sessionId) {
      sessionId = `demo_${crypto.randomBytes(16).toString('hex')}`;
    }

    req.demoSessionId = String(sessionId).trim();

    // Set cookie on outgoing response
    res.cookie('zyro_demo_session', req.demoSessionId, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      
    });

    // Expose header for API clients
    res.setHeader('X-Demo-Session-Id', req.demoSessionId);

    // Auto-seed permanent Demo Owner on session request ONLY if DEMO_SEED is explicitly enabled
    if (process.env.DEMO_SEED === 'true') {
      await seedDemoSession(pool, req.demoSessionId);
    }

    next();
  } catch (err) {
    console.error('[DEMO SESSION MIDDLEWARE] Error:', err.message);
    next();
  }
}

module.exports = demoSessionMiddleware;
