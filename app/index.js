const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'credpal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// GET /health - liveness probe
app.get('/health', (req, res) => {
  console.log(`[${new Date().toISOString()}] GET /health`);
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// GET /status - readiness probe with DB check
app.get('/status', async (req, res) => {
  console.log(`[${new Date().toISOString()}] GET /status`);
  try {
    await pool.query('SELECT 1');
    res.status(200).json({
      status: 'ready',
      db: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] DB connection error:`, err.message);
    res.status(503).json({ status: 'unavailable', db: 'disconnected' });
  }
});

// POST /process - sample data processing endpoint
app.post('/process', async (req, res) => {
  console.log(`[${new Date().toISOString()}] POST /process`, JSON.stringify(req.body));
  const { payload } = req.body;

  if (!payload) {
    return res.status(400).json({ error: 'Missing payload in request body' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO jobs (payload, created_at) VALUES ($1, NOW()) RETURNING id',
      [JSON.stringify(payload)]
    );
    res.status(201).json({ success: true, jobId: result.rows[0].id });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Process error:`, err.message);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Graceful shutdown
const server = app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] SIGTERM received. Shutting down gracefully...`);
  server.close(() => {
    pool.end();
    process.exit(0);
  });
});

module.exports = app;
