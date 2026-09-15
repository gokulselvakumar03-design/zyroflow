const pool = require('../config/db');

function getSessionId(req) {
  if (!pool.isDemoMode) return null;
  return req?.demoSessionId || req?.user?.demo_session_id || 'default';
}

exports.getRules = async (req, res, next) => {
  try {
    const sessionId = getSessionId(req);
    const sql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM rules WHERE demo_session_id = ? ORDER BY id'
      : 'SELECT * FROM rules ORDER BY id';
    const params = pool.isDemoMode && sessionId ? [sessionId] : [];

    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

exports.createRule = async (req, res, next) => {
  try {
    const { request_type, min_amount, max_amount, approvers } = req.body;
    const sessionId = getSessionId(req);

    if (!request_type || !approvers) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const minVal = min_amount != null ? Number(min_amount) : 0;
    const maxVal = max_amount != null ? Number(max_amount) : 0;

    let result;
    if (pool.isDemoMode && sessionId) {
      const [insRes] = await pool.execute(
        'INSERT INTO rules (demo_session_id, request_type, min_amount, max_amount, approvers) VALUES (?, ?, ?, ?, ?)',
        [sessionId, request_type, minVal, maxVal, approvers]
      );
      result = insRes;
    } else {
      const [insRes] = await pool.execute(
        'INSERT INTO rules (request_type, min_amount, max_amount, approvers) VALUES (?, ?, ?, ?)',
        [request_type, minVal, maxVal, approvers]
      );
      result = insRes;
    }

    const selectSql = pool.isDemoMode && sessionId
      ? 'SELECT * FROM rules WHERE demo_session_id = ? AND id = ?'
      : 'SELECT * FROM rules WHERE id = ?';
    const selectParams = pool.isDemoMode && sessionId ? [sessionId, result.insertId] : [result.insertId];

    const [ruleRows] = await pool.execute(selectSql, selectParams);
    res.status(201).json(ruleRows[0]);
  } catch (err) {
    next(err);
  }
};

exports.deleteRule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const sessionId = getSessionId(req);

    const sql = pool.isDemoMode && sessionId
      ? 'DELETE FROM rules WHERE demo_session_id = ? AND id = ?'
      : 'DELETE FROM rules WHERE id = ?';
    const params = pool.isDemoMode && sessionId ? [sessionId, id] : [id];

    await pool.execute(sql, params);
    res.json({ success: true, message: 'Rule deleted' });
  } catch (err) {
    next(err);
  }
};
