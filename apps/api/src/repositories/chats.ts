import { query } from '../db.js';

export type PendingBooking = { serviceId?: string; serviceName?: string; date?: string; time?: string; startsAt?: string; mode?: 'modify'; appointmentId?: string; appointmentIds?: string[] };
export type ChatSession = { id: string; title: string; pending_booking: PendingBooking | null; created_at: Date; updated_at: Date };

export async function getUnusedSession(businessId: string, userId: string) {
  const res = await query<{ id: string; title: string; createdAt: Date; updatedAt: Date }>(
    `SELECT s.id, s.title, s.created_at AS "createdAt", s.updated_at AS "updatedAt"
     FROM chat_sessions s
     WHERE s.business_id=$1 AND s.user_id=$2 AND s.title='New chat'
       AND NOT EXISTS (
         SELECT 1 FROM chat_messages m
         WHERE m.business_id=s.business_id AND m.session_id=s.id AND m.role='user'
       )
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [businessId, userId],
  );
  return res.rows[0] ?? null;
}

export async function createSession(businessId: string, userId: string, title = 'New chat') {
  return (await query(
    'INSERT INTO chat_sessions(business_id,user_id,title) VALUES($1,$2,$3) RETURNING id,title,created_at AS "createdAt",updated_at AS "updatedAt"',
    [businessId, userId, title.slice(0, 120)],
  )).rows[0];
}

export async function listSessions(businessId: string, userId: string) {
  return (await query(
    `SELECT s.id,s.title,s.created_at AS "createdAt",s.updated_at AS "updatedAt",
      (SELECT m.content FROM chat_messages m WHERE m.business_id=s.business_id AND m.session_id=s.id ORDER BY m.created_at DESC LIMIT 1) AS "lastMessage"
     FROM chat_sessions s WHERE s.business_id=$1 AND s.user_id=$2 ORDER BY s.updated_at DESC LIMIT 50`,
    [businessId, userId],
  )).rows;
}

export async function getOwnedSession(businessId: string, userId: string, sessionId: string): Promise<ChatSession | null> {
  return (await query<ChatSession>(
    'SELECT id,title,pending_booking,created_at,updated_at FROM chat_sessions WHERE business_id=$1 AND user_id=$2 AND id=$3',
    [businessId, userId, sessionId],
  )).rows[0] ?? null;
}

export async function listMessages(businessId: string, sessionId: string) {
  const result = await query(
    `SELECT id,role,content,metadata,created_at AS "createdAt"
     FROM chat_messages WHERE business_id=$1 AND session_id=$2 ORDER BY created_at DESC LIMIT 200`,
    [businessId, sessionId],
  );
  return restoreChronologicalOrder(result.rows);
}

export function restoreChronologicalOrder<T>(newestFirst: T[]): T[] {
  return newestFirst.reverse();
}

export async function appendMessage(
  businessId: string,
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata: Record<string, unknown> = {},
) {
  return (await query(
    `INSERT INTO chat_messages(business_id,session_id,role,content,metadata)
     VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id,role,content,metadata,created_at AS "createdAt"`,
    [businessId, sessionId, role, content, JSON.stringify(metadata)],
  )).rows[0];
}

export async function updateSession(
  businessId: string,
  userId: string,
  sessionId: string,
  title: string,
  pending: PendingBooking | null,
) {
  return (await query(
    `UPDATE chat_sessions SET title=$4,pending_booking=$5::jsonb,updated_at=now()
     WHERE business_id=$1 AND user_id=$2 AND id=$3 RETURNING id,title,updated_at AS "updatedAt"`,
    [businessId, userId, sessionId, title.slice(0, 120), pending ? JSON.stringify(pending) : null],
  )).rows[0] ?? null;
}

export async function writeAiLog(
  businessId: string,
  sessionId: string,
  request: unknown,
  response: unknown | null,
  latencyMs: number,
  errorCode: string | null,
) {
  await query(
    'INSERT INTO ai_logs(business_id,session_id,request_json,response_json,latency_ms,error_code) VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6)',
    [businessId, sessionId, JSON.stringify(request), response === null ? null : JSON.stringify(response), Math.max(0, Math.round(latencyMs)), errorCode],
  );
}
