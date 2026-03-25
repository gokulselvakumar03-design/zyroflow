const pool = require('../config/db');

exports.getRules = async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM rules ORDER BY id');
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

exports.createRule = async (req, res, next) => {
  try {
    const { request_type, min_amount, max_amount, approvers } = req.body;
    if (!request_type || min_amount == null || max_amount == null || !approvers) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const [result] = await pool.execute(
      'INSERT INTO rules (request_type, min_amount, max_amount, approvers) VALUES (?, ?, ?, ?)',
      [request_type, min_amount, max_amount, approvers]
    );

    const [ruleRows] = await pool.execute('SELECT * FROM rules WHERE id = ?', [result.insertId]);
    res.status(201).json(ruleRows[0]);
  } catch (err) {
    next(err);
  }
};
