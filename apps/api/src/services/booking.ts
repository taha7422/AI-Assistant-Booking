import { DateTime } from 'luxon';
import { HttpError } from '../middleware/errors.js';
import { cancelForUser, findService, insertAppointment, listForUser, overlaps, activeServices, updateAppointmentForUser } from '../repositories/appointments.js';
import { getBusiness } from '../repositories/businesses.js';
import { assertOfferedSlot, MAX_BOOKING_DAYS, MIN_BOOKING_LEAD_MINUTES, OPEN_MINUTE, parseLocalDate, SLOT_MINUTES } from './booking-rules.js';

export const getServices = (businessId: string) => activeServices(businessId);

export async function getAvailability(businessId: string, serviceId: string, date: string, now = new Date(), excludeAppointmentId?: string) {
  const [service, business] = await Promise.all([findService(businessId, serviceId), getBusiness(businessId)]);
  if (!service) throw new HttpError(400, 'Unknown or inactive service.', 'SERVICE_NOT_FOUND');
  if (!business) throw new HttpError(500, 'Business configuration is missing.', 'BUSINESS_NOT_CONFIGURED');
  const day = parseLocalDate(date, business.timezone);
  if (day.weekday > 5) throw new HttpError(400, 'Choose a weekday.', 'CLOSED_DAY');
  const slots: string[] = [];
  let localStart = day.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  const lastMinute = 17 * 60 - service.duration_minutes;
  while (localStart.hour * 60 + localStart.minute <= lastMinute) {
    const start = localStart.toUTC().toJSDate();
    const end = localStart.plus({ minutes: service.duration_minutes }).toUTC().toJSDate();
    const lead = (start.getTime() - now.getTime()) / 60_000;
    const leadDays = lead / (24 * 60);
    if (lead >= MIN_BOOKING_LEAD_MINUTES && leadDays <= MAX_BOOKING_DAYS && !(await overlaps(businessId, start, end, excludeAppointmentId))) {
      slots.push(start.toISOString());
    }
    localStart = localStart.plus({ minutes: SLOT_MINUTES });
  }
  return { date, timeZone: business.timezone, slots };
}

export async function createBooking(
  businessId: string,
  userId: string,
  serviceId: string,
  startsAt: string,
  createdVia: 'chat' | 'form' = 'form',
  now = new Date(),
) {
  const [service, business] = await Promise.all([findService(businessId, serviceId), getBusiness(businessId)]);
  if (!service) throw new HttpError(400, 'Unknown or inactive service.', 'SERVICE_NOT_FOUND');
  if (!business) throw new HttpError(500, 'Business configuration is missing.', 'BUSINESS_NOT_CONFIGURED');
  const start = new Date(startsAt);
  assertOfferedSlot(start, service.duration_minutes, business.timezone, now);
  const end = DateTime.fromJSDate(start, { zone: 'utc' }).plus({ minutes: service.duration_minutes }).toJSDate();
  if (await overlaps(businessId, start, end)) throw new HttpError(409, 'That time is no longer available.', 'SLOT_TAKEN');
  try {
    return await insertAppointment(businessId, userId, serviceId, start, end, createdVia);
  } catch (error) {
    if ((error as { code?: string }).code === '23P01') throw new HttpError(409, 'That time is no longer available.', 'SLOT_TAKEN');
    throw error;
  }
}

export const getAppointments = (businessId: string, userId: string) => listForUser(businessId, userId);

export async function modifyBooking(businessId: string, userId: string, id: string, serviceId: string, startsAt: string) {
  const owned = (await listForUser(businessId, userId, 'booked')).find((item: any) => item.id === id);
  if (!owned) throw new HttpError(404, 'Appointment not found or already cancelled.', 'APPOINTMENT_NOT_FOUND');
  const [service, business] = await Promise.all([findService(businessId, serviceId), getBusiness(businessId)]);
  if (!service) throw new HttpError(400, 'Unknown or inactive service.', 'SERVICE_NOT_FOUND');
  if (!business) throw new HttpError(500, 'Business configuration is missing.', 'BUSINESS_NOT_CONFIGURED');
  const start = new Date(startsAt);
  assertOfferedSlot(start, service.duration_minutes, business.timezone);
  const date = DateTime.fromJSDate(start, { zone: 'utc' }).setZone(business.timezone).toISODate()!;
  const available = await getAvailability(businessId, serviceId, date, new Date(), id);
  if (!available.slots.includes(start.toISOString())) throw new HttpError(409, 'That time is no longer available.', 'SLOT_TAKEN');
  try {
    const result = await updateAppointmentForUser(businessId, userId, id, serviceId, start, DateTime.fromJSDate(start, { zone: 'utc' }).plus({ minutes: service.duration_minutes }).toJSDate());
    if (!result) throw new HttpError(404, 'Appointment not found or already cancelled.', 'APPOINTMENT_NOT_FOUND');
    return result;
  } catch (error) {
    if ((error as { code?: string }).code === '23P01') throw new HttpError(409, 'That time is no longer available.', 'SLOT_TAKEN');
    throw error;
  }
}

export async function cancelBooking(businessId: string, userId: string, id: string) {
  const result = await cancelForUser(businessId, userId, id);
  if (!result) throw new HttpError(404, 'Appointment not found or already cancelled.', 'APPOINTMENT_NOT_FOUND');
  return result;
}
