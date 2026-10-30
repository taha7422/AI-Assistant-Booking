import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test';
process.env.JWT_SECRET ??= 'test-only-secret-that-is-long-enough-for-validation';
process.env.AI_PROVIDER = 'groq';
process.env.GROQ_API_KEY = 'test-groq-key';
process.env.GROQ_MODEL = 'openai/gpt-oss-120b';

const { extractBookingDetails, AssistantUnavailableError } = await import('../services/assistant.js');

const input = [{ role: 'user' as const, content: 'Book a Consultation on 2026-10-30 at 10:00.' }];
const validResponse = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          serviceName: 'Consultation',
          date: '2026-10-30',
          time: '10:00',
          isConfirmation: false,
          isChangeRequest: false,
        }),
      },
    },
  ],
};

test('extracts structured booking details using Groq completions endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const captured: { url: string; init?: RequestInit } = { url: '' };

  globalThis.fetch = (async (inputUrl, init) => {
    captured.url = String(inputUrl);
    captured.init = init;
    return new Response(JSON.stringify(validResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await extractBookingDetails(input, ['Consultation'], 'Europe/London', new Date('2026-10-29T10:00:00.000Z'));
    assert.equal(captured.url, 'https://api.groq.com/openai/v1/chat/completions');
    const headers = new Headers(captured.init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer test-groq-key');
    const body = JSON.parse(String(captured.init?.body));
    assert.equal(body.model, 'openai/gpt-oss-120b');
    assert.equal(body.response_format.type, 'json_object');
    assert.deepEqual(result.intent, {
      serviceName: 'Consultation',
      date: '2026-10-30',
      time: '10:00',
      isConfirmation: false,
      isChangeRequest: false,
    });
    assert.equal(result.provider, 'groq');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handles Groq rate limits gracefully by throwing AssistantUnavailableError', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'Rate limit' } }), { status: 429 })) as typeof fetch;

  try {
    await assert.rejects(
      async () => extractBookingDetails(input, ['Consultation'], 'Europe/London', new Date('2026-10-29T10:00:00.000Z')),
      (err: unknown) => err instanceof AssistantUnavailableError && err.code === 'GROQ_RATE_LIMIT',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
