import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
// Load project-root secrets first; allow an API-local .env as a fallback for standalone use.
dotenv.config({ path: resolve(moduleDirectory, '../../../.env') });
dotenv.config({ path: resolve(moduleDirectory, '../.env') });

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  DATABASE_URL: z.string().min(1).refine((value) => /^postgres(?:ql)?:\/\//i.test(value), 'must be a PostgreSQL connection URL'),
  JWT_SECRET: z.string().min(32),
  AI_PROVIDER: z.enum(['groq', 'mock']).default('groq'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  FRONTEND_ORIGIN: z.string().url().default('http://127.0.0.1:3000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`).join('; ');
  throw new Error(`Invalid API environment configuration: ${problems}. Copy .env.example to .env and set the local values.`);
}
if (parsed.data.NODE_ENV === 'production') {
  const normalizedJwtSecret = parsed.data.JWT_SECRET.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const knownPlaceholderSecrets = new Set([
    'secret', 'jwtsecret', 'secretkey', 'mysecret', 'password', 'changeme', 'changeit',
    'default', 'defaultsecret', 'developmentsecret', 'testsecret', 'testingsecret',
    'samplesecret', 'examplesecret', 'placeholdersecret', 'notasecret',
    'replacewitharandomsecretatleast32characters',
  ]);
  const containsPlaceholderMarker = /(?:replacewith|your[a-z0-9]*secret|mysecret|jwtsecret|changeme|changeit|default|development|devonly|testonly|testsecret|sample|example|placeholder|notasecret|password)/.test(normalizedJwtSecret);
  if (knownPlaceholderSecrets.has(normalizedJwtSecret) || containsPlaceholderMarker) {
    throw new Error('Invalid API environment configuration: JWT_SECRET must be a unique, non-placeholder secret in production.');
  }
}
if (parsed.data.NODE_ENV === 'production' && /^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(new URL(parsed.data.DATABASE_URL).hostname)) {
  throw new Error('Invalid API environment configuration: DATABASE_URL must point to the managed production database.');
}
if (parsed.data.NODE_ENV === 'production' && /^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(new URL(parsed.data.FRONTEND_ORIGIN).hostname)) {
  throw new Error('Invalid API environment configuration: FRONTEND_ORIGIN must point to the deployed frontend.');
}
if (parsed.data.NODE_ENV === 'production' && new URL(parsed.data.FRONTEND_ORIGIN).protocol !== 'https:') {
  throw new Error('Invalid API environment configuration: FRONTEND_ORIGIN must use HTTPS in production.');
}
if (parsed.data.NODE_ENV === 'production' && (parsed.data.AI_PROVIDER !== 'groq' || !parsed.data.GROQ_API_KEY?.trim())) {
  throw new Error('Invalid API environment configuration: production requires AI_PROVIDER=groq and a GROQ_API_KEY.');
}
export const env = parsed.data;
