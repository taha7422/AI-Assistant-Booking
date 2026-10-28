import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error?.code === '23P01') { res.status(409).json({ error: 'That time is no longer available.' }); return; }
  if (error?.code === '23505') { res.status(409).json({ error: 'A record with that value already exists.' }); return; }
  if (error instanceof ZodError) { res.status(400).json({ error: 'Request validation failed.', details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) }); return; }
  const status = error instanceof HttpError ? error.status : 500;
  if (status >= 500) console.error('request_failed', { name: error?.name });
  res.status(status).json({ error: status >= 500 ? 'Internal server error.' : error.message });
};
