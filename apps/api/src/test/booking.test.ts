import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOfferedSlot, assertOperatingTime, localSlotToUtc, parseLocalDate } from '../services/booking-rules.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const zone = 'Europe/London';

test('accepts a future weekday appointment within business hours and the booking window', () => {
  assert.doesNotThrow(() => assertOperatingTime(new Date('2026-01-05T09:00:00.000Z'), 30, zone, now));
});

test('rejects weekend, pre-opening and late appointments but allows the final half-hour slot', () => {
  assert.throws(() => assertOperatingTime(new Date('2026-01-04T10:00:00.000Z'), 30, zone, now), /Monday–Friday/);
  assert.throws(() => assertOperatingTime(new Date('2026-01-05T08:30:00.000Z'), 30, zone, now), /Monday–Friday/);
  assert.throws(() => assertOperatingTime(new Date('2026-01-05T16:30:00.000Z'), 60, zone, now), /Monday–Friday/);
  assert.doesNotThrow(() => assertOperatingTime(new Date('2026-01-05T16:30:00.000Z'), 30, zone, now));
});

test('rejects past, too-soon and more-than-30-day appointments', () => {
  assert.throws(() => assertOperatingTime(new Date('2025-12-31T10:00:00.000Z'), 30, zone, now), /one hour/);
  assert.throws(() => assertOperatingTime(new Date('2026-01-05T09:00:00.000Z'), 30, zone, new Date('2026-01-05T08:30:00.000Z')), /one hour/);
  assert.throws(() => assertOperatingTime(new Date('2026-02-02T09:00:00.000Z'), 30, zone, now), /30 days/);
});

test('accepts offered half-hour slots and rejects non-aligned minutes', () => {
  assert.doesNotThrow(() => assertOfferedSlot(new Date('2026-01-05T09:30:00.000Z'), 30, zone, now));
  assert.throws(() => assertOfferedSlot(new Date('2026-01-05T09:15:00.000Z'), 30, zone, now), /30-minute/);
});

test('converts business-local time correctly across standard and daylight time', () => {
  assert.equal(localSlotToUtc('2026-01-05', '09:00', zone).toISOString(), '2026-01-05T09:00:00.000Z');
  assert.equal(localSlotToUtc('2026-06-01', '09:00', zone).toISOString(), '2026-06-01T08:00:00.000Z');
});

test('rejects nonexistent local daylight-saving time and invalid calendar dates', () => {
  assert.throws(() => localSlotToUtc('2026-03-29', '01:30', zone), /does not exist/);
  assert.throws(() => parseLocalDate('2026-02-30', zone), /valid calendar date/);
});
