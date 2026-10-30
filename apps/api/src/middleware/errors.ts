import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_ERROR') {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const pgError = error as { code?: string; constraint?: string; name?: string; type?: string };
  if (pgError?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body contains malformed JSON.' } });
    return;
  }
  if (pgError?.code === '23P01') {
    res.status(409).json({ error: { code: 'SLOT_TAKEN', message: 'That time is no longer available. Choose another slot.' } });
    return;
  }
  if (pgError?.code === '23505') {
    const emailConflict = pgError.constraint === 'users_email_key' || pgError.constraint === 'users_business_email_key';
    res.status(409).json({ error: { code: emailConflict ? 'EMAIL_EXISTS' : 'CONFLICT', message: emailConflict ? 'An account with this email already exists. Sign in instead.' : 'A record with that value already exists.' } });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Check the submitted fields and try again.',
        details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    });
    return;
  }
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof HttpError ? error.message : 'Internal server error.';
  if (status >= 500) console.error('request_failed', { name: pgError?.name, code: pgError?.code });
  res.status(status).json({ error: { code, message } });
};
