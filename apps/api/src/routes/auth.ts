import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db.js';
import { env } from '../config.js';
import { HttpError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getDefaultBusiness } from '../repositories/businesses.js';

const router = Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'production' ? 10 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Please try again later.' } }),
});
const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
const registerSchema = z.object({
  name: z.string().trim().min(2).max(60),
  email: emailSchema,
  password: z.string().min(8).max(128)
    .regex(/\p{L}/u, 'Password must include a letter.')
    .regex(/\p{N}/u, 'Password must include a number.')
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes for bcrypt.'),
}).strict();

function createToken(userId: string, businessId: string) {
  return jwt.sign({ businessId }, env.JWT_SECRET, { subject: userId, expiresIn: '7d', issuer: 'ai-assistant-booking' });
}

async function register(req: import('express').Request, res: import('express').Response) {
  const input = registerSchema.parse(req.body);
  const business = await getDefaultBusiness();
  if (!business) throw new HttpError(503, 'Booking business is not configured. Run the database seed command.', 'BUSINESS_NOT_CONFIGURED');
  const passwordHash = await bcrypt.hash(input.password, 12);
  const result = await query<{ id: string; name: string; email: string }>(
    'INSERT INTO users(business_id,name,email,password_hash) VALUES($1,$2,$3,$4) RETURNING id,name,email',
    [business.id, input.name, input.email, passwordHash],
  );
  const user = result.rows[0];
  if (!user) throw new HttpError(500, 'Unable to create account.', 'ACCOUNT_CREATE_FAILED');
  res.status(201).json({ data: { user, token: createToken(user.id, business.id) } });
}
router.post(['/register', '/signup'], authLimiter, register);

router.post('/login', authLimiter, async (req, res) => {
  const input = loginSchema.parse(req.body);
  const found = await query<{ id: string; name: string; email: string; business_id: string; password_hash: string }>(
    'SELECT id,name,email,business_id,password_hash FROM users WHERE email=$1', [input.email],
  );
  const row = found.rows[0];
  if (!row || !(await bcrypt.compare(input.password, row.password_hash))) {
    throw new HttpError(401, 'Incorrect email or password.', 'INVALID_CREDENTIALS');
  }
  const { password_hash: _passwordHash, business_id: businessId, ...user } = row;
  res.json({ data: { user, token: createToken(user.id, businessId) } });
});

router.get('/me', requireAuth, async (req, res) => {
  if (!req.userId || !req.businessId) throw new HttpError(401, 'Authentication required.', 'AUTH_REQUIRED');
  const result = await query<{ id: string; name: string; email: string }>(
    'SELECT id,name,email FROM users WHERE id=$1 AND business_id=$2', [req.userId, req.businessId],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Account not found.', 'ACCOUNT_NOT_FOUND');
  res.json({ data: { user: result.rows[0] } });
});

export default router;
