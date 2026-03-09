const request = require('supertest');

// Mock the pg Pool before requiring the app
jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
    end: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

const { Pool } = require('pg');
const mockPool = new Pool();

const app = require('./index');

describe('GET /health', () => {
  it('should return 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('uptime');
  });
});

describe('GET /status', () => {
  it('should return 200 when DB is connected', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const res = await request(app).get('/status');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.db).toBe('connected');
  });

  it('should return 503 when DB is unreachable', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/status');
    expect(res.statusCode).toBe(503);
    expect(res.body.db).toBe('disconnected');
  });
});

describe('POST /process', () => {
  it('should return 400 when payload is missing', async () => {
    const res = await request(app).post('/process').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('should return 201 and a jobId when payload is valid', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    const res = await request(app)
      .post('/process')
      .send({ payload: { action: 'test' } });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.jobId).toBe(42);
  });

  it('should return 500 when DB insert fails', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('insert failed'));
    const res = await request(app)
      .post('/process')
      .send({ payload: { action: 'test' } });
    expect(res.statusCode).toBe(500);
  });
});
