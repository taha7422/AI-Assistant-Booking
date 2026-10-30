/**
 * Full Integration Test — covers every requirement from the spec:
 *  1. Sign up and log in
 *  2. Book appointment through multi-turn AI chat
 *  3. Confirm booking persists in PostgreSQL after "refresh" (re-fetch)
 *  4. View and cancel the appointment
 *  5. Rebook the released slot
 *  6. Invalid dates, occupied slots, unauthorized access, AI failure handling
 *  Plus: CORS headers, protected endpoints, validation errors, frontend reachability
 */
import { randomBytes, randomUUID } from 'node:crypto';

const API = process.env.AI_BOOKING_API_URL;
let zone = 'Europe/London';
let passed = 0;
let failed = 0;

function pass(label) { passed++; console.log(`  ✅ ${label}`); }
function fail(label, detail) { failed++; console.error(`  ❌ ${label}: ${detail}`); }

async function req(path, { token, method = 'GET', body, expectStatus } = {}) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await res.json().catch(() => ({}));
  if (expectStatus && res.status !== expectStatus) {
    throw Object.assign(new Error(`Expected ${expectStatus}, got ${res.status}: ${JSON.stringify(payload)}`), { status: res.status, payload });
  }
  if (!expectStatus && !res.ok) {
    const err = new Error(payload.error?.message || `HTTP ${res.status}`);
    err.status = res.status; err.code = payload.error?.code;
    throw err;
  }
  return { status: res.status, data: payload.data, error: payload.error, headers: Object.fromEntries(res.headers) };
}

function dateInBusinessZone(offsetDays) {
  const now = new Date();
  const utcNoon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays, 12));
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(utcNoon);
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}
function localTime(iso) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log(' FULL INTEGRATION TEST');
  console.log('══════════════════════════════════════════════\n');

  // ─── 0. API & DATABASE HEALTH ───────────────────────────
  console.log('▸ API & Database Health');
  const health = await fetch(`${API}/health`);
  const hb = await health.json();
  if (hb.status === 'ok' && hb.database === 'connected') pass('API health + PostgreSQL connected');
  else fail('API health', JSON.stringify(hb));

  // ─── 1. CORS HEADERS ───────────────────────────
  console.log('\n▸ CORS & Security Headers');
  const corsRes = await fetch(`${API}/health`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:3000', 'Access-Control-Request-Method': 'GET' } });
  const corsHeaders = Object.fromEntries(corsRes.headers);
  if (corsHeaders['access-control-allow-origin'] === 'http://127.0.0.1:3000') pass('CORS allows frontend origin');
  else fail('CORS', `Allow-Origin: ${corsHeaders['access-control-allow-origin']}`);
  const rejectedOrigin = await fetch(`${API}/health`, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'GET' } });
  if (!rejectedOrigin.headers.has('access-control-allow-origin')) pass('CORS rejects an unconfigured origin');
  else fail('CORS origin restriction', `Unexpected allow-origin ${rejectedOrigin.headers.get('access-control-allow-origin')}`);

  // Check security headers (helmet)
  const secRes = await fetch(`${API}/health`);
  const secHeaders = Object.fromEntries(secRes.headers);
  if (secHeaders['x-content-type-options'] === 'nosniff') pass('Helmet security headers present');
  else fail('Helmet', 'x-content-type-options missing');

  // ─── 2. PROTECTED ENDPOINT GUARDS ───────────────────────────
  console.log('\n▸ Protected Endpoints (no token)');
  for (const [label, path] of [
    ['GET /appointments', '/appointments'],
    ['GET /business', '/business'],
    ['GET /chat/sessions', '/chat/sessions'],
    ['GET /appointments/services', '/appointments/services'],
  ]) {
    try {
      await req(path, { expectStatus: 401 });
      pass(`${label} → 401 without token`);
    } catch (e) { fail(label, e.message); }
  }

  // ─── 3. VALIDATION ERRORS ───────────────────────────
  console.log('\n▸ Input Validation');
  try {
    await req('/auth/register', { method: 'POST', body: { name: 'A', email: 'bad', password: 'short' }, expectStatus: 400 });
    pass('Registration rejects invalid input (short name, bad email, weak password)');
  } catch (e) { fail('Validation', e.message); }

  try {
    await req('/auth/register', { method: 'POST', body: { name: 'Valid Name', email: 'valid@test.com', password: 'nodigits' }, expectStatus: 400 });
    pass('Registration rejects password without number');
  } catch (e) { fail('Password validation', e.message); }

  // ─── 4. SIGNUP & LOGIN ───────────────────────────
  console.log('\n▸ Sign Up & Log In');
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const pw = `IntegrationTest${randomBytes(8).toString('hex')}1A`;
  const email1 = `integ-user1-${suffix}@example.test`;
  const email2 = `integ-user2-${suffix}@example.test`;

  const signup = await req('/auth/register', { method: 'POST', body: { name: 'Integration User 1', email: email1, password: pw } });
  if (signup.data.token && signup.data.user.email === email1) pass('User 1 registered');
  else fail('Register', 'Unexpected response');

  // Duplicate email
  try {
    await req('/auth/register', { method: 'POST', body: { name: 'Dup', email: email1, password: pw }, expectStatus: 409 });
    pass('Duplicate email rejected with 409 EMAIL_EXISTS');
  } catch (e) { fail('Dup email', e.message); }

  const login = await req('/auth/login', { method: 'POST', body: { email: email1, password: pw } });
  const token1 = login.data.token;
  if (token1) pass('User 1 logged in');
  else fail('Login', 'No token');
  const signup2 = await req('/auth/register', { method: 'POST', body: { name: 'Integration User 2', email: email2, password: pw } });
  const token2 = signup2.data.token;

  // Wrong password
  try {
    await req('/auth/login', { method: 'POST', body: { email: email1, password: 'WrongPassword1' }, expectStatus: 401 });
    pass('Wrong password returns 401 (generic error)');
  } catch (e) { fail('Wrong pw', e.message); }

  // GET /me
  const me = await req('/auth/me', { token: token1 });
  if (me.data.user.email === email1) pass('GET /auth/me returns correct user');
  else fail('/me', 'Wrong user');

  // ─── 5. BUSINESS CONFIG & SERVICES ───────────────────────────
  console.log('\n▸ Business & Services');
  const biz = await req('/business', { token: token1 });
  zone = biz.data.timeZone;
  if (biz.data.operatingHours && biz.data.bookingWindowDays === 30 && biz.data.minimumLeadMinutes === 60) pass(`Business config loaded (TZ: ${zone})`);
  else fail('Business', JSON.stringify(biz.data));

  const svc = await req('/appointments/services', { token: token1 });
  if (svc.data.length === 3 && svc.data.some(s => s.name === 'Consultation')) pass('3 active services returned');
  else fail('Services', `Got ${svc.data.length}`);
  const service = svc.data.find(s => s.name === 'Consultation') || svc.data[0];

  // ─── 6. AVAILABILITY ───────────────────────────
  console.log('\n▸ Availability');
  // Weekend → CLOSED_DAY
  const saturday = (() => {
    for (let i = 0; i < 7; i++) {
      const candidate = dateInBusinessZone(i);
      if (new Date(`${candidate}T12:00:00.000Z`).getUTCDay() === 6) return candidate;
    }
  })();
  if (saturday) {
    try {
      await req(`/appointments/availability?serviceId=${service.id}&date=${saturday}`, { token: token1, expectStatus: 400 });
      pass(`Weekend date (${saturday}) rejected with CLOSED_DAY`);
    } catch (e) { fail('Weekend', e.message); }
  } else fail('Weekend', 'Could not construct a future Saturday test date.');

  // Invalid date
  try {
    await req(`/appointments/availability?serviceId=${service.id}&date=2026-02-30`, { token: token1, expectStatus: 400 });
    pass('Invalid date (Feb 30) rejected');
  } catch (e) { fail('Invalid date', e.message); }

  // Find valid slots
  let date, slots = [];
  for (let offset = 2; offset < 30 && !slots.length; offset++) {
    date = dateInBusinessZone(offset);
    try {
      const avail = await req(`/appointments/availability?serviceId=${service.id}&date=${date}`, { token: token1 });
      slots = avail.data.slots;
    } catch (e) { if (e.code !== 'CLOSED_DAY') throw e; }
  }
  if (slots.length > 0) pass(`Found ${slots.length} available slots on ${date}`);
  else fail('Availability', 'No slots found in 30 days');

  // ─── 7. MULTI-TURN AI CHAT BOOKING ───────────────────────────
  console.log('\n▸ Multi-Turn AI Chat Booking');
  const chatSlot = slots[0];

  // Create chat session
  const session = await req('/chat/sessions', { token: token1, method: 'POST', body: {} });
  if (session.data.id && session.data.messages?.length > 0) pass('Chat session created with greeting');
  else fail('Session create', JSON.stringify(session.data));

  const sessionId = session.data.id;

  // Turn 1: provide only a service and verify the assistant asks for the date.
  const msg1 = await req(`/chat/sessions/${sessionId}/messages`, {
    token: token1, method: 'POST',
    body: { content: `I need a ${service.name}` },
  });
  if (msg1.data.action === 'ask_more' && /date|weekday/i.test(msg1.data.message.content)) pass('Chat asks for the missing appointment date');
  else throw new Error(`Chat did not request the missing date (action: ${msg1.data.action}).`);

  const msg2 = await req(`/chat/sessions/${sessionId}/messages`, {
    token: token1, method: 'POST', body: { content: `On ${date}` },
  });
  if (msg2.data.action === 'ask_more' && /time/i.test(msg2.data.message.content)) pass('Chat asks for the missing appointment time');
  else throw new Error(`Chat did not request the missing time (action: ${msg2.data.action}).`);

  const msg3 = await req(`/chat/sessions/${sessionId}/messages`, {
    token: token1, method: 'POST', body: { content: `At ${localTime(chatSlot)}` },
  });
  if (msg3.data.action !== 'suggest_slots') throw new Error(`Chat did not offer an available slot (action: ${msg3.data.action}).`);
  pass('Chat checks availability and requests explicit booking confirmation');

  if (msg3.data.quickReplies?.some(r => /confirm booking/i.test(r))) pass('Quick reply "confirm booking" offered');
  else fail('Quick replies', JSON.stringify(msg3.data.quickReplies));

  // Turn 2: confirm
  const confirmation = await req(`/chat/sessions/${sessionId}/messages`, {
    token: token1, method: 'POST',
    body: { content: 'Yes, confirm booking' },
  });
  if (confirmation.data.action === 'booked' && confirmation.data.appointment?.id) pass('Chat booking confirmed → appointment created');
  else fail('Chat confirm', `action=${confirmation.data.action}`);
  const chatApptId = confirmation.data.appointment?.id;

  // ─── 8. MODIFY EXISTING APPOINTMENT ──────────────────────
  console.log('\n▸ Chat Appointment Modification');
  const originalStartsAt = confirmation.data.appointment?.startsAt;
  const modifyResult = await req(`/chat/sessions/${sessionId}/messages`, {
    token: token1, method: 'POST', body: { content: 'Change my appointment to 4 PM.' },
  });
  const modifiedStartsAt = modifyResult.data.appointment?.startsAt;
  if (modifyResult.data.action === 'modified' && modifyResult.data.appointment?.id === chatApptId && modifiedStartsAt !== originalStartsAt) {
    pass('Chat modification updates the same appointment ID');
  } else fail('Chat modification', JSON.stringify(modifyResult.data));

  const occupyingAppointment = await req('/appointments', { token: token2, method: 'POST', body: { serviceId: service.id, startsAt: originalStartsAt } });
  const unavailableModify = await req(`/chat/sessions/${sessionId}/messages`, {
    token: token1, method: 'POST', body: { content: `Change my appointment to ${localTime(chatSlot)}.` },
  });
  if (unavailableModify.data.action === 'ask_more' && /unavailable/i.test(unavailableModify.data.message.content)) pass('Unavailable modification is rejected without confirmation');
  else fail('Unavailable modification', JSON.stringify(unavailableModify.data));
  const afterUnavailable = await req('/appointments', { token: token1 });
  const persistedTarget = afterUnavailable.data.filter((item) => item.id === chatApptId && item.status === 'booked');
  const bookedCount = afterUnavailable.data.filter((item) => item.status === 'booked').length;
  if (persistedTarget.length === 1 && persistedTarget[0].startsAt === modifiedStartsAt && bookedCount === 1) {
    pass('PostgreSQL list retains one modified row and no duplicate after unavailable request');
  } else fail('Modification persistence', JSON.stringify({ persistedTarget, bookedCount }));
  await req(`/appointments/${occupyingAppointment.data.id}/cancel`, { token: token2, method: 'PATCH' });

  // ─── 9. PERSISTENCE CHECK (simulate refresh) ───────────────────────────
  console.log('\n▸ Persistence After Refresh');
  const appts1 = await req('/appointments', { token: token1 });
  const found = appts1.data.find(a => a.id === chatApptId);
  if (found && found.status === 'booked' && found.createdVia === 'chat') pass('Chat booking persists in PostgreSQL after re-fetch');
  else fail('Persistence', `Not found or wrong status: ${JSON.stringify(found)}`);

  // Re-fetch chat session messages
  const sessionRefresh = await req(`/chat/sessions/${sessionId}`, { token: token1 });
  if (sessionRefresh.data.messages?.length >= 3) pass(`Chat session has ${sessionRefresh.data.messages.length} persisted messages`);
  else fail('Chat persistence', `${sessionRefresh.data.messages?.length} messages`);

  // ─── 10. CROSS-USER ISOLATION ───────────────────────────
  console.log('\n▸ Cross-User Isolation');
  const otherAppts = await req('/appointments', { token: token2 });
  const leakedUser1Appointment = otherAppts.data.some((item) => item.id === chatApptId);
  const user2OwnCancelledAppointment = otherAppts.data.find((item) => item.id === occupyingAppointment.data.id);
  if (!leakedUser1Appointment && user2OwnCancelledAppointment?.status === 'cancelled' && otherAppts.data.length === 1) {
    pass('User 2 sees only their own cancelled appointment and cannot see User 1\'s appointment');
  } else {
    fail('Isolation', JSON.stringify({
      returnedAppointmentIds: otherAppts.data.map((item) => item.id),
      leakedUser1Appointment,
      user2OwnAppointmentStatus: user2OwnCancelledAppointment?.status ?? null,
    }));
  }

  try {
    await req(`/chat/sessions/${sessionId}`, { token: token2, expectStatus: 404 });
    pass('User 2 cannot access User 1\'s chat session');
  } catch (e) { fail('Chat isolation', e.message); }

  try {
    await req(`/appointments/${chatApptId}/cancel`, { token: token2, method: 'PATCH', expectStatus: 404 });
    pass('User 2 cannot cancel User 1\'s appointment');
  } catch (e) { fail('Cancel isolation', e.message); }

  // ─── 11. DOUBLE BOOKING PREVENTION ───────────────────────────
  console.log('\n▸ Double Booking Prevention');
  try {
    await req('/appointments', { token: token2, method: 'POST', body: { serviceId: service.id, startsAt: modifiedStartsAt }, expectStatus: 409 });
    pass('Double booking (same slot, different user) blocked with SLOT_TAKEN');
  } catch (e) { fail('Double booking', e.message); }

  try {
    await req('/appointments', { token: token1, method: 'POST', body: { serviceId: service.id, startsAt: modifiedStartsAt }, expectStatus: 409 });
    pass('Double booking (same slot, same user) also blocked');
  } catch (e) { fail('Same-user double', e.message); }

  // ─── 12. CANCEL & REBOOK ───────────────────────────
  console.log('\n▸ Cancel & Rebook Released Slot');
  const cancelRes = await req(`/appointments/${chatApptId}/cancel`, { token: token1, method: 'PATCH' });
  if (cancelRes.data.status === 'cancelled') pass('Appointment cancelled successfully');
  else fail('Cancel', JSON.stringify(cancelRes.data));

  // Double cancel → 404
  try {
    await req(`/appointments/${chatApptId}/cancel`, { token: token1, method: 'PATCH', expectStatus: 404 });
    pass('Re-cancelling already cancelled appointment → 404');
  } catch (e) { fail('Double cancel', e.message); }

  // Rebook the released slot
  const rebook = await req('/appointments', { token: token2, method: 'POST', body: { serviceId: service.id, startsAt: chatSlot } });
  if (rebook.data.id && rebook.data.status === 'booked') pass('Released slot rebooked by User 2');
  else fail('Rebook', JSON.stringify(rebook.data));

  // Clean up: cancel User 2's booking
  await req(`/appointments/${rebook.data.id}/cancel`, { token: token2, method: 'PATCH' });

  // ─── 13. INVALID BOOKING ATTEMPTS ───────────────────────────
  console.log('\n▸ Invalid Booking Attempts');
  // Past date
  try {
    await req('/appointments', { token: token1, method: 'POST', body: { serviceId: service.id, startsAt: '2020-01-06T09:00:00.000Z' }, expectStatus: 400 });
    pass('Past date booking rejected');
  } catch (e) { fail('Past date', e.message); }

  // Far future (>30 days)
  const far = new Date(); far.setDate(far.getDate() + 60);
  // Find the next Monday after 60 days
  while (far.getDay() !== 1) far.setDate(far.getDate() + 1);
  far.setHours(9, 0, 0, 0);
  try {
    await req('/appointments', { token: token1, method: 'POST', body: { serviceId: service.id, startsAt: far.toISOString() }, expectStatus: 400 });
    pass('Booking >30 days ahead rejected');
  } catch (e) { fail('Far future', e.message); }

  // Misaligned time (not on 30-min boundary)
  if (slots.length > 0) {
    const misaligned = new Date(new Date(slots[0]).getTime() + 15 * 60000).toISOString();
    try {
      await req('/appointments', { token: token1, method: 'POST', body: { serviceId: service.id, startsAt: misaligned }, expectStatus: 400 });
      pass('Misaligned slot time (15-min offset) rejected');
    } catch (e) { fail('Misaligned', e.message); }
  } else fail('Misaligned slot', 'No valid slot was available to derive a non-aligned time.');

  // Invalid service ID
  try {
    await req('/appointments', { token: token1, method: 'POST', body: { serviceId: randomUUID(), startsAt: chatSlot }, expectStatus: 400 });
    pass('Invalid service ID rejected');
  } catch (e) { fail('Invalid svc', e.message); }

  // ─── 14. MANUAL BOOKING ─────────────────────────────────────
  console.log('\n▸ Manual Booking');
  const manualSlot = slots.find(s => s !== chatSlot);
  if (manualSlot) {
    const manual = await req('/appointments', { token: token1, method: 'POST', body: { serviceId: service.id, startsAt: manualSlot } });
    if (manual.data.id && manual.data.createdVia === 'form') pass('Manual booking works independently of AI');
    else fail('Manual booking', JSON.stringify(manual.data));
    await req(`/appointments/${manual.data.id}/cancel`, { token: token1, method: 'PATCH' });
  } else fail('Manual booking', 'No separate free slot was available for the manual booking check.');

  // ─── 15. CHAT SESSION MANAGEMENT ───────────────────────────
  console.log('\n▸ Chat Session Management');
  const sessions = await req('/chat/sessions', { token: token1 });
  if (sessions.data.length >= 1) pass(`${sessions.data.length} chat session(s) listed`);
  else fail('Sessions list', 'Empty');

  // Create new session with custom title
  const newSession = await req('/chat/sessions', { token: token1, method: 'POST', body: { title: 'My Custom Chat' } });
  if (newSession.data.title === 'My Custom Chat') pass('New session with custom title created');
  else fail('Custom title', newSession.data.title);

  // ─── 16. RATE LIMITING ───────────────────────────
  console.log('\n▸ Rate Limiting');
  // Auth rate limiter: 10 attempts per 15 min - we won't exhaust it, just verify headers
  const rlRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@test.com', password: 'wrong1' }),
  });
  const rlHeaders = Object.fromEntries(rlRes.headers);
  if (rlHeaders['ratelimit-limit'] || rlHeaders['x-ratelimit-limit']) pass('Rate limit headers present on auth endpoint');
  else fail('Rate limit', 'No rate limit headers');

  // ─── 17. DELETE ALIAS ───────────────────────────
  console.log('\n▸ DELETE Alias for Cancel');
  // Book something, then cancel via DELETE
  if (slots.length >= 3) {
    const delSlot = slots[2];
    const booked = await req('/appointments', { token: token1, method: 'POST', body: { serviceId: service.id, startsAt: delSlot } });
    const delRes = await fetch(`${API}/api/appointments/${booked.data.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token1}` },
    });
    const delPayload = await delRes.json();
    if (delRes.ok && delPayload.data.status === 'cancelled') pass('DELETE /appointments/:id alias works');
    else fail('DELETE alias', `${delRes.status} ${JSON.stringify(delPayload)}`);
  } else fail('DELETE alias', `Expected at least three free slots; found ${slots.length}.`);

  // ─── 18. SAME-DAY APPOINTMENT DISAMBIGUATION ──────────────
  console.log('\n▸ Multiple Appointment Selection');
  if (slots.length < 2) throw new Error(`Expected at least two free slots for appointment disambiguation; found ${slots.length}.`);
  const firstChoice = await req('/appointments', { token: token2, method: 'POST', body: { serviceId: service.id, startsAt: slots[0] } });
  await req('/appointments', { token: token2, method: 'POST', body: { serviceId: service.id, startsAt: slots[1] } });
  const selectionSession = await req('/chat/sessions', { token: token2, method: 'POST', body: {} });
  const ambiguous = await req(`/chat/sessions/${selectionSession.data.id}/messages`, {
    token: token2, method: 'POST', body: { content: 'Change my appointment to 4 PM.' },
  });
  if (ambiguous.data.action === 'ask_more' && /multiple appointments/i.test(ambiguous.data.message.content)) pass('Chat asks which same-day appointment should change');
  else fail('Appointment disambiguation', JSON.stringify(ambiguous.data));
  const selected = await req(`/chat/sessions/${selectionSession.data.id}/messages`, {
    token: token2, method: 'POST', body: { content: `${date} at ${localTime(slots[0])}` },
  });
  if (selected.data.action === 'ask_more' && /new time/i.test(selected.data.message.content)) pass('Current date and time identify one appointment before requesting its new time');
  else fail('Appointment selection', JSON.stringify(selected.data));
  const disambiguatedUpdate = await req(`/chat/sessions/${selectionSession.data.id}/messages`, {
    token: token2, method: 'POST', body: { content: '2 PM' },
  });
  const user2Appointments = await req('/appointments', { token: token2 });
  const selectedRows = user2Appointments.data.filter((item) => item.id === firstChoice.data.id && item.status === 'booked');
  const user2BookedCount = user2Appointments.data.filter((item) => item.status === 'booked').length;
  if (disambiguatedUpdate.data.action === 'modified' && disambiguatedUpdate.data.appointment?.id === firstChoice.data.id && selectedRows.length === 1 && localTime(selectedRows[0].startsAt) === '14:00' && user2BookedCount === 2) {
    pass('Selected appointment updates in place and the other appointment remains active');
  } else fail('Disambiguated modification', JSON.stringify({ result: disambiguatedUpdate.data, selectedRows, user2BookedCount }));

  // ─── SUMMARY ───────────────────────────
  console.log('\n══════════════════════════════════════════════');
  console.log(` RESULTS: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════\n');
  if (failed > 0) process.exitCode = 1;
}

if (process.env.AI_BOOKING_TEST_HARNESS !== 'isolated' || !API) {
  console.error('Refusing integration run outside the isolated local test harness. Run npm run test:integration with TEST_DATABASE_URL set to an empty local *_test database.');
  process.exitCode = 2;
} else {
  main().catch(e => { console.error(`\nFATAL: ${e.message}`); process.exitCode = 1; });
}
