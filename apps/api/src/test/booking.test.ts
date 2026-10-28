import test from 'node:test';import assert from 'node:assert/strict';import {assertOperatingTime,assertOfferedSlot} from '../services/booking-rules.js';
const fixedNow=new Date('2026-01-01T00:00:00Z');
test('accepts future weekday appointment wholly within UTC operating hours',()=>{assert.doesNotThrow(()=>assertOperatingTime(new Date('2099-10-26T09:00:00Z'),30,fixedNow));});
test('rejects weekend appointments',()=>{assert.throws(()=>assertOperatingTime(new Date('2099-10-25T10:00:00Z'),30,fixedNow),/Monday/);});
test('rejects starts before opening and appointments extending after close',()=>{assert.throws(()=>assertOperatingTime(new Date('2099-10-26T08:30:00Z'),30,fixedNow),/Monday/);assert.throws(()=>assertOperatingTime(new Date('2099-10-26T16:30:00Z'),60,fixedNow),/Monday/);});
test('rejects appointments ending on a different day',()=>{assert.throws(()=>assertOperatingTime(new Date('2099-10-26T23:30:00Z'),60,fixedNow),/Monday/);});
test('rejects appointments in the past',()=>{assert.throws(()=>assertOperatingTime(new Date('2025-12-31T10:00:00Z'),30,fixedNow),/future/);});
test('accepts a future half-hour start and rejects unoffered minute values',()=>{assert.doesNotThrow(()=>assertOfferedSlot(new Date('2099-10-26T09:30:00Z'),30,fixedNow));assert.throws(()=>assertOfferedSlot(new Date('2099-10-26T09:15:00Z'),30,fixedNow),/30-minute/);});
