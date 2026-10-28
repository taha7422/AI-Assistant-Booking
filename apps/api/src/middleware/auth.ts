import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config.js';
import { HttpError } from './errors.js';
declare global { namespace Express { interface Request { userId?: string } } }
export const requireAuth: RequestHandler = (req, _res, next) => {
  try { const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]; if (!token) throw new HttpError(401,'Authentication required.');
    const payload = jwt.verify(token, env.JWT_SECRET, {issuer:'ai-assistant-booking'}); if (typeof payload === 'string' || !payload.sub) throw new HttpError(401,'Invalid token.'); req.userId = payload.sub; next();
  } catch { next(new HttpError(401,'Invalid or expired token.')); }
};
