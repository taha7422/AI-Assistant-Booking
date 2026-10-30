import rateLimit from 'express-rate-limit';

// Mounted after requireAuth; share this instance across both AI chat routes.
export const chatMessageLimiter = rateLimit({
  windowMs: 60_000,
  limit: 6,
  keyGenerator: (req) => `user:${req.businessId ?? 'unknown'}:${req.userId ?? 'unknown'}`,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    error: { code: 'CHAT_RATE_LIMITED', message: 'Too many chat messages. Please wait before sending another.' },
  }),
});
