import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test';
process.env.JWT_SECRET ??= 'test-only-secret-that-is-long-enough-for-validation';
process.env.AI_PROVIDER = 'mock';
process.env.GROQ_API_KEY = '';
const { answer } = await import('../services/assistant.js');
const now = new Date('2026-06-01T12:00:00.000Z');

test('mock assistant extracts service, relative date and 12-hour time without provider access', async () => {
  const result = await answer([{ role: 'user', content: 'I need a Check-up tomorrow at 2:30 pm.' }], ['Consultation', 'Check-up', 'Follow-up'], 'Europe/London', now);
  assert.equal(result.provider, 'mock');
  assert.deepEqual(result.intent, {
    serviceName: 'Check-up',
    date: '2026-06-02',
    time: '14:30',
    isConfirmation: false,
    isChangeRequest: false,
  });
});

test('mock assistant retains booking context across a follow-up message', async () => {
  const result = await answer([
    { role: 'user', content: 'Please book a Consultation on 2026-06-03.' },
    { role: 'assistant', content: 'What time would you prefer?' },
    { role: 'user', content: '10:30' },
  ], ['Consultation', 'Check-up'], 'Europe/London', now);
  assert.deepEqual(result.intent, {
    serviceName: 'Consultation',
    date: '2026-06-03',
    time: '10:30',
    isConfirmation: false,
    isChangeRequest: false,
  });
});
