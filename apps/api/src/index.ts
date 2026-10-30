import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config.js';
import { logger } from './logger.js';
import auth from './routes/auth.js';
import appointments from './routes/appointments.js';
import assistant from './routes/assistant.js';
import chat from './routes/chat.js';
import business from './routes/business.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { pool } from './db.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY_HOPS);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const localDevelopmentOrigin = env.NODE_ENV !== 'production' && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
    return callback(null, localDevelopmentOrigin || origin === env.FRONTEND_ORIGIN);
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path !== '/health') logger.info({ method: req.method, path: req.path, statusCode: res.statusCode, durationMs: Date.now() - started }, 'request');
  });
  next();
});
app.use('/api', rateLimit({
  windowMs: 60_000, limit: 100, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } }),
}));
app.get('/', (_req, res) => {
  res.json({
    name: 'AI Assistant Booking API',
    status: 'running',
    health: '/health',
    frontend: env.FRONTEND_ORIGIN,
    endpoints: {
      health: 'GET /health',
      auth: 'POST /api/auth/register, POST /api/auth/login, GET /api/auth/me',
      business: 'GET /api/business',
      appointments: 'GET /api/appointments, POST /api/appointments, PATCH /api/appointments/:id/cancel',
      chat: 'GET /api/chat/sessions, POST /api/chat/sessions, POST /api/chat/sessions/:id/messages',
    },
  });
});
app.get('/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({
    status: 'ok',
    database: 'connected',
    ...(env.NODE_ENV === 'test' && process.env.TEST_RUN_ID ? { testRunId: process.env.TEST_RUN_ID } : {}),
  });
});
app.use('/api/auth', auth);
app.use('/api/business', requireAuth, business);
app.use('/api/appointments', requireAuth, appointments);
app.use('/api/chat', requireAuth, chat);
app.use('/api/assistant', requireAuth, assistant);
app.use('/api', notFoundHandler);
app.use(errorHandler);

const host = '0.0.0.0';
const server = app.listen(env.PORT, host, () => logger.info({ port: env.PORT, host }, 'api_started'));
const shutdown = () => server.close(() => pool.end().finally(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
