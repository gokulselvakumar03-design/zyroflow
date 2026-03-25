const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const authRoutes = require('./routes/authRoutes');
const rulesRoutes = require('./routes/rulesRoutes');
const requestsRoutes = require('./routes/requestsRoutes');
const approvalsRoutes = require('./routes/approvalsRoutes');
const trackRoutes = require('./routes/trackRoutes');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static('frontend'));

app.use('/api/auth', authRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api', approvalsRoutes); // /api/approve, /api/reject, /api/pending-approvals
app.use('/api', trackRoutes); // /api/track/:requestId

app.get('/', (req, res) => {
  res.json({ message: 'Multi-Level Approval Workflow API is running' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
