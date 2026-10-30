import { DateTime } from 'luxon';
import { HttpError } from '../middleware/errors.js';

export const SLOT_MINUTES = 30;
export const OPEN_MINUTE = 9 * 60;
export const CLOSE_MINUTE = 17 * 60;
export const MIN_BOOKING_LEAD_MINUTES = 60;
export const MAX_BOOKING_DAYS = 30;

export function assertTimeZone(timeZone: string): void {
  if (!DateTime.now().setZone(timeZone).isValid) {
    throw new HttpError(500, 'The business timezone is not configured correctly.', 'BUSINESS_TIMEZONE_INVALID');
  }
}

export function parseLocalDate(date: string, timeZone: string): DateTime {
  const local = DateTime.fromISO(date, { zone: timeZone });
  if (!local.isValid || local.toISODate() !== date) throw new HttpError(400, 'Choose a valid calendar date.', 'INVALID_DATE');
  return local.startOf('day');
}

export function localSlotToUtc(date: string, time: string, timeZone: string): Date {
  const local = DateTime.fromISO(`${date}T${time}`, { zone: timeZone });
  if (!local.isValid || local.toFormat('yyyy-MM-dd') !== date || local.toFormat('HH:mm') !== time) {
    throw new HttpError(400, 'That local time does not exist in the business timezone.', 'INVALID_LOCAL_TIME');
  }
  return local.toUTC().toJSDate();
}

export function assertOperatingTime(start: Date, durationMinutes: number, timeZone: string, now = new Date()): void {
  if (!Number.isFinite(start.getTime())) throw new HttpError(400, 'Choose a valid appointment time.', 'INVALID_TIME');
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 480) throw new HttpError(400, 'The service duration is not valid.', 'INVALID_SERVICE_DURATION');
  assertTimeZone(timeZone);
  const localStart = DateTime.fromJSDate(start, { zone: 'utc' }).setZone(timeZone);
  const localEnd = localStart.plus({ minutes: durationMinutes });
  const minuteOfDay = localStart.hour * 60 + localStart.minute;
  const endMinuteOfDay = localEnd.hour * 60 + localEnd.minute;
  if (localStart.weekday > 5 || minuteOfDay < OPEN_MINUTE || localEnd.toISODate() !== localStart.toISODate() || endMinuteOfDay > CLOSE_MINUTE) {
    throw new HttpError(400, 'Appointments are available Monday–Friday, 09:00–17:00 business local time.', 'OUTSIDE_OPERATING_HOURS');
  }
  const leadMinutes = (start.getTime() - now.getTime()) / 60_000;
  if (leadMinutes < MIN_BOOKING_LEAD_MINUTES) throw new HttpError(400, 'Choose a time at least one hour in the future.', 'BOOKING_TOO_SOON');
  if (leadMinutes > MAX_BOOKING_DAYS * 24 * 60) throw new HttpError(400, 'Appointments can be booked up to 30 days in advance.', 'BOOKING_TOO_FAR');
}

export function assertOfferedSlot(start: Date, durationMinutes: number, timeZone: string, now = new Date()): void {
  if (!Number.isFinite(start.getTime())) throw new HttpError(400, 'Choose a valid appointment time.', 'INVALID_TIME');
  const localStart = DateTime.fromJSDate(start, { zone: 'utc' }).setZone(timeZone);
  if (localStart.minute % SLOT_MINUTES !== 0 || localStart.second !== 0 || localStart.millisecond !== 0) {
    throw new HttpError(400, 'Choose an offered 30-minute start time.', 'INVALID_SLOT_ALIGNMENT');
  }
  assertOperatingTime(start, durationMinutes, timeZone, now);
}
