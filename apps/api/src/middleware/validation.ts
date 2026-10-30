import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const shortTextSchema = z.string().trim().min(1).max(500);
