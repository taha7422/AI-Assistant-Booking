import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { errorHandler, HttpError, notFoundHandler } from '../middleware/errors.js';

function responseRecorder() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.payload = payload; return this; },
  };
}

test('unknown API routes return the standard JSON 404 error', () => {
  const res = responseRecorder();
  notFoundHandler({} as never, res as never, (() => {}) as never);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.payload, { error: { code: 'NOT_FOUND', message: 'Route not found.' } });
});

test('malformed JSON parser errors return a clear JSON 400 error', () => {
  const res = responseRecorder();
  errorHandler({ type: 'entity.parse.failed', message: 'parser detail', stack: 'internal stack' }, {} as never, res as never, (() => {}) as never);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: { code: 'INVALID_JSON', message: 'Request body contains malformed JSON.' } });
});

test('application errors keep their existing status, code and message', () => {
  const res = responseRecorder();
  errorHandler(new HttpError(409, 'That time is unavailable.', 'SLOT_TAKEN'), {} as never, res as never, (() => {}) as never);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.payload, { error: { code: 'SLOT_TAKEN', message: 'That time is unavailable.' } });
});

test('validation errors keep their existing JSON response', () => {
  const res = responseRecorder();
  const result = z.object({ name: z.string() }).safeParse({ name: 1 });
  assert.equal(result.success, false);
  if (!result.success) errorHandler(result.error, {} as never, res as never, (() => {}) as never);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Check the submitted fields and try again.',
      details: [{ path: 'name', message: 'Invalid input: expected string, received number' }],
    },
  });
});

test('unexpected errors do not expose internal details or stack traces', () => {
  const res = responseRecorder();
  errorHandler(new Error('secret connection detail'), {} as never, res as never, (() => {}) as never);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.payload, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
  assert.equal(JSON.stringify(res.payload).includes('secret connection detail'), false);
  assert.equal(JSON.stringify(res.payload).includes('stack'), false);
});
