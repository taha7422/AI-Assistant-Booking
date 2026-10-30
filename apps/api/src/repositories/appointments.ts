import { query } from '../db.js';

export type Service = { id: string; name: string; duration_minutes: number };

export const activeServices = async (businessId: string) =>
  (await query<Service & { durationMinutes: number }>(
    'SELECT id,name,duration_minutes,duration_minutes AS "durationMinutes" FROM services WHERE business_id=$1 AND active=true ORDER BY name',
    [businessId],
  )).rows;

export async function findService(businessId: string, id: string): Promise<Service | null> {
  return (await query<Service>(
    'SELECT id,name,duration_minutes FROM services WHERE business_id=$1 AND id=$2 AND active=true',
    [businessId, id],
  )).rows[0] ?? null;
}

export async function findServiceByName(businessId: string, name: string): Promise<Service | null> {
  return (await query<Service>(
    'SELECT id,name,duration_minutes FROM services WHERE business_id=$1 AND active=true AND lower(name)=lower($2)',
    [businessId, name.trim()],
  )).rows[0] ?? null;
}

export async function overlaps(businessId: string, start: Date, end: Date, excludeId?: string): Promise<boolean> {
  return ((await query(
    "SELECT 1 FROM appointments WHERE business_id=$1 AND status='booked' AND ($4::uuid IS NULL OR id<>$4) AND tstzrange(starts_at,ends_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)') LIMIT 1",
    [businessId, start.toISOString(), end.toISOString(), excludeId ?? null],
  )).rowCount ?? 0) > 0;
}

export async function updateAppointmentForUser(businessId: string, userId: string, id: string, serviceId: string, start: Date, end: Date) {
  return (await query(
    `UPDATE appointments SET service_id=$4,starts_at=$5,ends_at=$6
     WHERE business_id=$1 AND user_id=$2 AND id=$3 AND status='booked'
     RETURNING id,service_id AS "serviceId",starts_at AS "startsAt",ends_at AS "endsAt",status,created_via AS "createdVia"`,
    [businessId, userId, id, serviceId, start.toISOString(), end.toISOString()],
  )).rows[0] ?? null;
}

export async function insertAppointment(
  businessId: string,
  userId: string,
  serviceId: string,
  start: Date,
  end: Date,
  createdVia: 'chat' | 'form',
) {
  return (await query(
    `INSERT INTO appointments(business_id,user_id,service_id,starts_at,ends_at,status,created_via)
     VALUES($1,$2,$3,$4,$5,'booked',$6)
     RETURNING id,service_id AS "serviceId",starts_at AS "startsAt",ends_at AS "endsAt",status,created_via AS "createdVia"`,
    [businessId, userId, serviceId, start.toISOString(), end.toISOString(), createdVia],
  )).rows[0];
}

export async function listForUser(businessId: string, userId: string, status?: 'booked') {
  return (await query(
    `SELECT a.id,a.service_id AS "serviceId",s.name AS "serviceName",
            a.starts_at AS "startsAt",a.ends_at AS "endsAt",a.status,
            a.created_via AS "createdVia"
     FROM appointments a JOIN services s ON s.business_id=a.business_id AND s.id=a.service_id
     WHERE a.business_id=$1 AND a.user_id=$2 AND ($3::text IS NULL OR a.status=$3) ORDER BY a.starts_at DESC`,
    [businessId, userId, status ?? null],
  )).rows;
}

export async function cancelForUser(businessId: string, userId: string, id: string) {
  return (await query(
    "UPDATE appointments SET status='cancelled' WHERE business_id=$1 AND user_id=$2 AND id=$3 AND status='booked' RETURNING id,status",
    [businessId, userId, id],
  )).rows[0] ?? null;
}
