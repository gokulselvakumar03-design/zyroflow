// JWT Authentication Middleware
// Verifies Bearer JWT token from Authorization header or query parameter
// Attaches decoded user payload (id, role, name, email) to req.user

const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }

  const secret = process.env.JWT_SECRET || 'secret';
  jwt.verify(token, secret, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    req.user = decoded;
    if (decoded && decoded.demo_expires_at) {
      if (new Date() >= new Date(decoded.demo_expires_at)) {
        return res.status(401).json({ message: 'Demo access has expired. Please contact us for new access.' });
      }
    }
    if (decoded && decoded.demo_session_id) {
      req.demoSessionId = decoded.demo_session_id;
    }
    next();
  });
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return next();
  }

  const secret = process.env.JWT_SECRET || 'secret';
  jwt.verify(token, secret, (err, decoded) => {
    if (!err && decoded) {
      req.user = decoded;
      if (decoded.demo_session_id && !req.demoSessionId) {
        req.demoSessionId = decoded.demo_session_id;
      }
    }
    next();
  });
}

module.exports = authMiddleware;
module.exports.optionalAuth = optionalAuth;
