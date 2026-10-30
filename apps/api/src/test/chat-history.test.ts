import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test';
process.env.JWT_SECRET ??= 'test-only-secret-that-is-long-enough-for-validation';

const { restoreChronologicalOrder } = await import('../repositories/chats.js');

test('AI context uses the newest messages beyond 200 and keeps chronological order', () => {
  const allMessages = Array.from({ length: 250 }, (_, index) => ({
    role: index % 2 === 0 ? 'assistant' : 'user',
    content: `message-${index + 1}`,
  }));
  // listMessages asks PostgreSQL for the latest 200 in descending order.
  const databaseRowsNewestFirst = allMessages.slice(-200).reverse();
  const chronologicalRows = restoreChronologicalOrder(databaseRowsNewestFirst);
  const aiContext = chronologicalRows.slice(-6);

  assert.equal(chronologicalRows.length, 200);
  assert.equal(chronologicalRows[0]?.content, 'message-51');
  assert.equal(chronologicalRows.at(-1)?.content, 'message-250');
  assert.deepEqual(aiContext.map((message) => message.content), [
    'message-245', 'message-246', 'message-247', 'message-248', 'message-249', 'message-250',
  ]);
  assert.equal(aiContext.some((message) => message.content === 'message-1'), false);
  assert.equal(aiContext.some((message) => message.content === 'message-50'), false);
});
