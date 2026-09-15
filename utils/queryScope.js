const pool = require('../config/db');

/**
 * Gets the active demo session ID for the given request if demo mode is enabled.
 * Returns null if in production mode.
 */
function getDemoSessionId(req) {
  if (!pool.isDemoMode) return null;
  return req?.demoSessionId || req?.user?.demo_session_id || 'default';
}

/**
 * Appends demo_session_id scoping to a SQL WHERE clause if in demo mode.
 * @param {string} baseSql - The SQL query string
 * @param {Array} params - Array of query parameters
 * @param {string|null} sessionId - The demo session ID
 * @param {string} [tableAlias] - Optional table alias (e.g. 'wr' or 'u')
 */
function scopeQuery(baseSql, params = [], sessionId = null, tableAlias = '') {
  if (!pool.isDemoMode || !sessionId) {
    return { sql: baseSql, params };
  }

  const colPrefix = tableAlias ? `${tableAlias}.` : '';
  const condition = `${colPrefix}demo_session_id = ?`;

  let newSql = baseSql;
  const upperSql = baseSql.toUpperCase();

  if (upperSql.includes(' WHERE ')) {
    newSql = baseSql.replace(/ WHERE /i, ` WHERE ${condition} AND `);
  } else if (upperSql.includes(' ORDER BY ')) {
    newSql = baseSql.replace(/ ORDER BY /i, ` WHERE ${condition} ORDER BY `);
  } else if (upperSql.includes(' GROUP BY ')) {
    newSql = baseSql.replace(/ GROUP BY /i, ` WHERE ${condition} GROUP BY `);
  } else if (upperSql.includes(' LIMIT ')) {
    newSql = baseSql.replace(/ LIMIT /i, ` WHERE ${condition} LIMIT `);
  } else {
    newSql = `${baseSql} WHERE ${condition}`;
  }

  return {
    sql: newSql,
    params: [sessionId, ...params]
  };
}

module.exports = {
  getDemoSessionId,
  scopeQuery
};
