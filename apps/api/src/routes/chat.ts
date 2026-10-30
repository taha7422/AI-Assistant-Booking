import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../middleware/errors.js';
import { chatMessageLimiter } from '../middleware/chat-rate-limit.js';
import { appendMessage, createSession, getOwnedSession, getUnusedSession, listMessages, listSessions } from '../repositories/chats.js';
import { processChatMessage } from '../services/chat.js';

const router = Router();
const messageSchema = z.object({ content: z.string().trim().min(1).max(500) }).strict();
function authScope(req: Express.Request) {
  if (!req.userId || !req.businessId) throw new HttpError(401, 'Authentication required.', 'AUTH_REQUIRED');
  return { userId: req.userId, businessId: req.businessId };
}

router.get('/sessions', async (req, res) => {
  const { userId, businessId } = authScope(req);
  res.json({ data: await listSessions(businessId, userId) });
});
router.post('/sessions', async (req, res) => {
  const { userId, businessId } = authScope(req);
  const title = req.body?.title === undefined ? 'New chat' : z.string().trim().min(1).max(120).parse(req.body.title);
  if (title === 'New chat') {
    const existing = await getUnusedSession(businessId, userId);
    if (existing) {
      return res.status(200).json({ data: { ...existing, messages: await listMessages(businessId, existing.id) } });
    }
  }
  const session = await createSession(businessId, userId, title);
  if (!session) throw new HttpError(500, 'Unable to create chat session.', 'CHAT_SESSION_CREATE_FAILED');
  await appendMessage(businessId, session.id, 'assistant', 'Hi! Tell me the service you need and a weekday/date and time. I will check availability and ask before confirming a booking.', { action: 'ask_more', quickReplies: [] });
  res.status(201).json({ data: { ...session, messages: await listMessages(businessId, session.id) } });
});
router.get('/sessions/:id', async (req, res) => {
  const { userId, businessId } = authScope(req);
  const id = z.string().uuid().parse(req.params.id);
  const session = await getOwnedSession(businessId, userId, id);
  if (!session) throw new HttpError(404, 'Chat session not found.', 'CHAT_SESSION_NOT_FOUND');
  res.json({ data: { id: session.id, title: session.title, messages: await listMessages(businessId, id) } });
});
router.post('/sessions/:id/messages', chatMessageLimiter, async (req, res) => {
  const { userId, businessId } = authScope(req);
  const id = z.string().uuid().parse(req.params.id);
  const input = messageSchema.parse(req.body);
  res.json({ data: await processChatMessage(businessId, userId, id, input.content) });
});
export default router;
