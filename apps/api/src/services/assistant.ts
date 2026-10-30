import { DateTime } from 'luxon';
import { z } from 'zod';
import { env } from '../config.js';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

const historySchema = z.array(
  z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(500),
  })
).min(1).max(10);

export const bookingIntentSchema = z.object({
  serviceName: z.string().trim().nullable().default(null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  isConfirmation: z.boolean().default(false),
  isChangeRequest: z.boolean().default(false),
});

export type BookingIntent = z.infer<typeof bookingIntentSchema>;

export class AssistantUnavailableError extends Error {
  constructor(public code: string, public diagnostics: Record<string, unknown> = {}) {
    super('Assistant is unavailable.');
    this.name = 'AssistantUnavailableError';
  }
}

function parseTime(text: string): string | null {
  const twelveHour = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (twelveHour) {
    let hour = Number(twelveHour[1]);
    if (!Number.isFinite(hour)) return null;
    hour %= 12;
    if (twelveHour[3]?.toLowerCase().startsWith('p')) hour += 12;
    return `${String(hour).padStart(2, '0')}:${twelveHour[2] ?? '00'}`;
  }
  const twentyFourHour = text.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
  return twentyFourHour?.[1] && twentyFourHour[2] ? `${twentyFourHour[1]}:${twentyFourHour[2]}` : null;
}

function parseDate(text: string, timeZone: string, now: Date): string | null {
  const explicit = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (explicit?.[1]) return explicit[1];
  const localToday = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(timeZone).startOf('day');
  const lower = text.toLowerCase();
  if (/\btomorrow\b/.test(lower)) return localToday.plus({ days: 1 }).toISODate();
  if (/\btoday\b/.test(lower)) return localToday.toISODate();
  const weekdays: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };
  for (const [name, weekday] of Object.entries(weekdays)) {
    if (new RegExp(`\\b(?:next\\s+)?${name}\\b`).test(lower)) {
      let days = (weekday - localToday.weekday + 7) % 7;
      if (days === 0 || new RegExp(`\\bnext\\s+${name}\\b`).test(lower)) days = days || 7;
      return localToday.plus({ days }).toISODate();
    }
  }
  const inDays = lower.match(/\bin\s+(\d{1,2})\s+days?\b/);
  if (inDays?.[1]) return localToday.plus({ days: Number(inDays[1]) }).toISODate();
  return null;
}

function cleanJsonString(str: string): string {
  const trimmed = str.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch?.[1] ? fenceMatch[1].trim() : trimmed;
}

export function mockExtract(history: ChatMessage[], serviceNames: string[], timeZone: string, now = new Date()): BookingIntent {
  const userMessages = history.filter((m) => m.role === 'user');
  const lastUserText = userMessages.at(-1)?.content || '';
  const combined = userMessages.map((m) => m.content).join(' ');

  const serviceName = [...serviceNames].sort((a, b) => b.length - a.length)
    .find((name) => combined.toLowerCase().includes(name.toLowerCase())) ?? null;
  const date = [...userMessages].reverse().map((m) => parseDate(m.content, timeZone, now)).find(Boolean) ?? null;
  const time = [...userMessages].reverse().map((m) => parseTime(m.content)).find(Boolean) ?? null;

  const isConfirmation = /^(?:yes|y|confirm|confirm booking|yes[,! ]+confirm|yes[,! ]+book|book it)\.?$/i.test(lastUserText.trim());
  const isChangeRequest = /^(?:no|choose another time|different time|change time|cancel)$/i.test(lastUserText.trim());

  return { serviceName, date, time, isConfirmation, isChangeRequest };
}

async function requestGroqExtract(
  history: ChatMessage[],
  serviceNames: string[],
  timeZone: string,
  now = new Date(),
): Promise<{ intent: BookingIntent; model: string }> {
  if (!env.GROQ_API_KEY) {
    throw new AssistantUnavailableError('GROQ_MISSING_KEY');
  }

  const model = env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const today = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(timeZone).toISODate();

  const systemPrompt = `You are a precise appointment details extractor.
Business timezone: ${timeZone}
Today's date: ${today}
Available services: ${serviceNames.join(', ')}

Analyze the conversation and extract:
1. serviceName: exact matched service name from available services, or null.
2. date: target appointment date formatted as YYYY-MM-DD. Resolve relative dates like 'tomorrow' using today's date (${today}). Return null if not specified.
3. time: appointment time in 24-hour HH:mm format (e.g. 10:00, 14:30). Return null if not specified.
4. isConfirmation: boolean, true ONLY if the user is confirming/accepting a booking offer (e.g. "yes", "confirm", "book it"), false otherwise.
5. isChangeRequest: boolean, true ONLY if the user wants to change time or decline (e.g. "no", "different time", "cancel"), false otherwise.

Respond strictly with valid JSON matching:
{"serviceName": string|null, "date": "YYYY-MM-DD"|null, "time": "HH:mm"|null, "isConfirmation": boolean, "isChangeRequest": boolean}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const code = res.status === 429 ? 'GROQ_RATE_LIMIT' : `GROQ_HTTP_${res.status}`;
      throw new AssistantUnavailableError(code, { httpStatus: res.status });
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new AssistantUnavailableError('GROQ_EMPTY_RESPONSE');

    const parsed = bookingIntentSchema.parse(JSON.parse(cleanJsonString(content)));
    return { intent: parsed, model };
  } catch (error) {
    if (error instanceof AssistantUnavailableError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AssistantUnavailableError('GROQ_TIMEOUT');
    }
    throw new AssistantUnavailableError('GROQ_NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractBookingDetails(
  rawMessages: unknown,
  serviceNames: string[],
  timeZone: string,
  now = new Date(),
): Promise<{ intent: BookingIntent; provider: 'groq' | 'mock'; model: string | null }> {
  const history = historySchema.parse(rawMessages);
  if (history.at(-1)?.role !== 'user') throw new AssistantUnavailableError('INVALID_CHAT_HISTORY');

  if (env.AI_PROVIDER === 'mock' || !env.GROQ_API_KEY) {
    return { intent: mockExtract(history, serviceNames, timeZone, now), provider: 'mock', model: null };
  }

  const { intent, model } = await requestGroqExtract(history, serviceNames, timeZone, now);
  return { intent, provider: 'groq', model };
}

export async function answer(
  messages: unknown,
  serviceNames: string[],
  timeZone: string,
  now = new Date(),
) {
  const extracted = await extractBookingDetails(messages, serviceNames, timeZone, now);
  return {
    reply: '',
    intent: extracted.intent,
    provider: extracted.provider,
    model: extracted.model,
    diagnostics: {},
  };
}
