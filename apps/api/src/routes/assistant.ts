import { Router } from 'express';
import { z } from 'zod';
import { chatMessageLimiter } from '../middleware/chat-rate-limit.js';
import { HttpError } from '../middleware/errors.js';
import { getBusiness } from '../repositories/businesses.js';
import { activeServices } from '../repositories/appointments.js';
import { answer, AssistantUnavailableError } from '../services/assistant.js';
import { env } from '../config.js';
import { logger } from '../logger.js';

const router = Router();
const messagesSchema = z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(500) })).min(1).max(6);
router.post('/chat', chatMessageLimiter, async (req, res) => {
  if (!req.userId || !req.businessId) throw new HttpError(401, 'Authentication required.', 'AUTH_REQUIRED');
  const messages = messagesSchema.parse(req.body?.messages);
  if (messages.at(-1)?.role !== 'user') throw new HttpError(400, 'The final chat message must be from the user.', 'INVALID_CHAT_HISTORY');
  const [business, services] = await Promise.all([getBusiness(req.businessId), activeServices(req.businessId)]);
  if (!business) throw new HttpError(500, 'Business configuration is missing.', 'BUSINESS_NOT_CONFIGURED');
  const started = Date.now();
  const historyCharacters = messages.reduce((total, message) => total + message.content.length, 0);
  try {
    const result = await answer(messages, services.map((service) => service.name), business.timezone);
    if (result.provider === 'groq') logger.info({ provider: result.provider, model: result.model, latencyMs: Date.now() - started }, 'assistant_provider_call_succeeded');
    res.json({ data: result });
  } catch (error) {
    const diagnostics = error instanceof AssistantUnavailableError ? error.diagnostics : {};
    const failureCode = error instanceof AssistantUnavailableError ? error.code : 'AI_INVALID_RESPONSE';
    logger.warn({ provider: 'groq', model: env.GROQ_MODEL, failureCode, latencyMs: Date.now() - started, ...diagnostics }, 'assistant_provider_failed');
    res.status(503).json({ data: { action: 'show_form', reply: 'The assistant is temporarily unavailable. Continue with the manual booking form.' } });
  }
});
export default router;
