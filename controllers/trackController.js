const pool = require('../config/db');

exports.trackRequest = async (req, res, next) => {
  try {
    const requestId = req.params.requestId;
    const [requests] = await pool.execute('SELECT * FROM requests WHERE id = ?', [requestId]);
    const request = requests[0];

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const [rows] = await pool.execute(
      `SELECT a.approver_role, a.status, a.updated_at, r.created_at
       FROM approvals a
       JOIN requests r ON a.request_id = r.id
       WHERE a.request_id = ?
       ORDER BY a.step`,
      [requestId]
    );

    const workflow = rows.map((row) => {
      let approval_time = null;
      if (row.status === 'approved' && row.updated_at && row.created_at) {
        const updatedAt = new Date(row.updated_at);
        const createdAt = new Date(row.created_at);
        const diffMs = updatedAt - createdAt;
        const diffMinutes = Math.round(diffMs / 60000);
        approval_time = `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`;
      }

      return {
        approver_role: row.approver_role,
        status: row.status,
        approval_time,
      };
    });

    res.json({ request, workflow });
  } catch (err) {
    next(err);
  }
};
