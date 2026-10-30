import { DateTime } from 'luxon';
import { HttpError } from '../middleware/errors.js';
import { logger } from '../logger.js';
import { env } from '../config.js';
import { getBusiness } from '../repositories/businesses.js';
import { activeServices } from '../repositories/appointments.js';
import { getAppointments, modifyBooking } from './booking.js';
import { appendMessage, getOwnedSession, listMessages, updateSession, writeAiLog, type PendingBooking } from '../repositories/chats.js';
import { createBooking, getAvailability } from './booking.js';
import { extractBookingDetails, AssistantUnavailableError } from './assistant.js';
import { bookingConfirmationDecision, createBookingOnExplicitConfirmation } from './booking-confirmation.js';
import { assertOfferedSlot, localSlotToUtc } from './booking-rules.js';

const isChangeRequestText = (text: string) => /^(?:no|choose another time|different time|change time|cancel)$/i.test(text.trim());
const shortTitle = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 100) || 'New chat';

const parseTimeFromText = (text: string) => {
  const twelveHour = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (twelveHour) {
    let hour = Number(twelveHour[1]) % 12;
    if (twelveHour[3]?.toLowerCase().startsWith('p')) hour += 12;
    return `${String(hour).padStart(2, '0')}:${twelveHour[2] ?? '00'}`;
  }
  const value = text.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
  return value?.[1] && value[2] ? `${value[1]}:${value[2]}` : null;
};

async function saveReply(
  businessId: string,
  userId: string,
  sessionId: string,
  title: string,
  pending: PendingBooking | null,
  content: string,
  action: 'ask_more' | 'suggest_slots' | 'booked' | 'modified' | 'show_form' | 'error',
  options: { quickReplies?: string[]; appointment?: unknown; provider?: 'groq' | 'mock'; model?: string | null } = {},
) {
  const metadata = {
    action,
    quickReplies: options.quickReplies ?? [],
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.appointment ? { appointment: options.appointment } : {}),
  };
  const message = await appendMessage(businessId, sessionId, 'assistant', content, metadata);
  await updateSession(businessId, userId, sessionId, title, pending);
  return {
    sessionId,
    message,
    action,
    quickReplies: metadata.quickReplies,
    ...(options.appointment ? { appointment: options.appointment } : {}),
  };
}

async function freeTimeReply(
  businessId: string,
  userId: string,
  sessionId: string,
  title: string,
  pending: PendingBooking,
  timeZone: string,
  provider?: 'groq' | 'mock',
  model?: string | null,
) {
  if (!pending.serviceId || !pending.date) {
    return saveReply(businessId, userId, sessionId, title, pending, 'Tell me the service and weekday date you would like.', 'ask_more', { provider, model });
  }
  const available = await getAvailability(businessId, pending.serviceId, pending.date);
  const suggestions = available.slots.slice(0, 3).map((slot) => DateTime.fromISO(slot, { zone: 'utc' }).setZone(timeZone).toFormat('HH:mm'));
  if (!suggestions.length) {
    return saveReply(businessId, userId, sessionId, title, { serviceId: pending.serviceId, serviceName: pending.serviceName, date: pending.date }, 'There are no available times on that date. Please choose another weekday.', 'ask_more', { provider, model });
  }
  return saveReply(businessId, userId, sessionId, title, { serviceId: pending.serviceId, serviceName: pending.serviceName, date: pending.date }, 'That time is unavailable. Choose one of these free business-local times:', 'suggest_slots', { quickReplies: suggestions, provider, model });
}

export async function processChatMessage(businessId: string, userId: string, sessionId: string, rawContent: string) {
  const content = rawContent.trim();
  if (!content || content.length > 500) throw new HttpError(400, 'Message must contain 1–500 characters.', 'INVALID_MESSAGE');

  const [session, business] = await Promise.all([getOwnedSession(businessId, userId, sessionId), getBusiness(businessId)]);
  if (!session) throw new HttpError(404, 'Chat session not found.', 'CHAT_SESSION_NOT_FOUND');
  if (!business) throw new HttpError(500, 'Business configuration is missing.', 'BUSINESS_NOT_CONFIGURED');

  const title = session.title === 'New chat' ? shortTitle(content) : session.title;
  await appendMessage(businessId, sessionId, 'user', content);
  const previous = session.pending_booking ?? null;

  // Appointment changes are resolved only from this authenticated user's active bookings.
  const isModifyRequest = /\b(?:change|modify|move|reschedule)\b/i.test(content) && /\b(?:appointment|booking|time|to)\b/i.test(content);
  if (isModifyRequest || previous?.mode === 'modify') {
    const appointments = (await getAppointments(businessId, userId)).filter((item: any) => item.status === 'booked');
    let target = previous?.mode === 'modify' ? appointments.find((item: any) => item.id === previous.appointmentId) : null;
    if (!target && previous?.appointmentIds?.length) {
      const selectedDate = content.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
      const selectedTime = parseTimeFromText(content);
      const choices = appointments.filter((item: any) => previous.appointmentIds!.includes(item.id));
      const matched = selectedDate && selectedTime ? choices.filter((item: any) => {
        const localStart = DateTime.fromJSDate(new Date(item.startsAt), { zone: 'utc' }).setZone(business.timezone);
        return localStart.toISODate() === selectedDate && localStart.toFormat('HH:mm') === selectedTime;
      }) : [];
      const selectedTarget = matched.length === 1 ? matched[0] : undefined;
      if (selectedTarget) {
        target = selectedTarget;
        const targetDate = DateTime.fromJSDate(new Date(selectedTarget.startsAt), { zone: 'utc' }).setZone(business.timezone).toISODate()!;
        return saveReply(businessId, userId, sessionId, title, {
          mode: 'modify', appointmentId: selectedTarget.id, serviceId: selectedTarget.serviceId,
          serviceName: selectedTarget.serviceName, date: targetDate,
        }, `Which new time would you like for your ${selectedTarget.serviceName} on ${DateTime.fromISO(targetDate, { zone: business.timezone }).toFormat('ccc, dd LLL')}?`, 'ask_more');
      }
      return saveReply(businessId, userId, sessionId, title, previous, 'Please identify the appointment by its current date and time (for example, YYYY-MM-DD at 09:00), then tell me the new time.', 'ask_more');
    }
    if (!target && isModifyRequest) {
      const dateMention = content.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
      const requestedDay = dateMention ?? ( /\btomorrow\b/i.test(content) ? DateTime.now().setZone(business.timezone).plus({ days: 1 }).toISODate() : null );
      const candidates = requestedDay ? appointments.filter((item: any) => DateTime.fromJSDate(new Date(item.startsAt)).setZone(business.timezone).toISODate() === requestedDay) : appointments;
      if (candidates.length === 1) target = candidates[0];
      else if (candidates.length > 1) {
        const choices = candidates.map((item: any) => DateTime.fromJSDate(new Date(item.startsAt)).setZone(business.timezone).toFormat('ccc, dd LLL h:mm a'));
        return saveReply(businessId, userId, sessionId, title, { mode: 'modify', appointmentIds: candidates.map((item: any) => item.id) }, `You have multiple appointments. Which one should I change? ${choices.join('; ')}. Reply with its current date and time (YYYY-MM-DD at HH:mm).`, 'ask_more');
      }
    }
    if (!target) return saveReply(businessId, userId, sessionId, title, null, 'I could not identify one active appointment to change. Please include its date, or tell me which appointment you mean.', 'ask_more');
    const date = content.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] ?? DateTime.fromJSDate(new Date(target.startsAt)).setZone(business.timezone).toISODate()!;
    const time = parseTimeFromText(content) ?? (previous?.mode === 'modify' ? parseTimeFromText(content) : null);
    const modifyPending: PendingBooking = { mode: 'modify', appointmentId: target.id, serviceId: target.serviceId, serviceName: target.serviceName, date, ...(time ? { time } : {}) };
    if (!time) return saveReply(businessId, userId, sessionId, title, modifyPending, `What time would you like for your ${target.serviceName} on ${DateTime.fromISO(date, { zone: business.timezone }).toFormat('ccc, dd LLL')}?`, 'ask_more');
    try {
      const startsAt = localSlotToUtc(date, time, business.timezone).toISOString();
      const appointment = await modifyBooking(businessId, userId, target.id, target.serviceId, startsAt);
      const local = DateTime.fromISO(startsAt, { zone: 'utc' }).setZone(business.timezone);
      return await saveReply(businessId, userId, sessionId, title, null, `Appointment updated: ${target.serviceName} on ${local.toFormat('ccc, dd LLL')} at ${local.toFormat('h:mm a')} (${business.timezone}).`, 'modified', { appointment });
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) return saveReply(businessId, userId, sessionId, title, modifyPending, 'That time is unavailable. Please choose another time for this appointment.', 'ask_more');
      if (error instanceof HttpError && error.status === 400) return saveReply(businessId, userId, sessionId, title, modifyPending, error.message, 'ask_more');
      throw error;
    }
  }

  // 1. Direct confirmation of an already proposed slot
  if (previous?.startsAt && previous.serviceId) {
    try {
      const confirmation = await createBookingOnExplicitConfirmation(content, () =>
        createBooking(businessId, userId, previous.serviceId!, previous.startsAt!, 'chat'));
      if (confirmation.action === 'created') {
        const local = DateTime.fromISO(previous.startsAt, { zone: 'utc' }).setZone(business.timezone);
        const reply = `Appointment booked: ${previous.serviceName ?? 'service'} on ${local.toFormat('ccc, dd LLL')} at ${local.toFormat('h:mm a')} (${business.timezone}).`;
        return await saveReply(businessId, userId, sessionId, title, null, reply, 'booked', { appointment: confirmation.appointment });
      }
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        return freeTimeReply(businessId, userId, sessionId, title, { ...previous, startsAt: undefined, time: undefined }, business.timezone);
      }
      throw error;
    }
  }

  // 2. Direct change request of an already proposed slot
  if (previous?.startsAt && isChangeRequestText(content)) {
    return saveReply(businessId, userId, sessionId, title, { ...previous, startsAt: undefined, time: undefined }, 'What other time should I check?', 'ask_more');
  }

  // 3. AI Extraction via Groq
  const storedMessages = await listMessages(businessId, sessionId);
  const history = storedMessages.slice(-6).map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content as string }));
  const services = await activeServices(businessId);
  const names = services.map((s) => s.name);
  const started = Date.now();

  let extractedDetails: Awaited<ReturnType<typeof extractBookingDetails>>;
  try {
    extractedDetails = await extractBookingDetails(history, names, business.timezone);
    const latencyMs = Date.now() - started;
    await writeAiLog(businessId, sessionId, { historyCount: history.length }, extractedDetails, latencyMs, null);
    logger.info({ provider: extractedDetails.provider, model: extractedDetails.model, latencyMs }, 'booking_intent_extracted');
  } catch (error) {
    const code = error instanceof AssistantUnavailableError ? error.code : 'AI_EXTRACTION_FAILED';
    const latencyMs = Date.now() - started;
    logger.warn({ failureCode: code, latencyMs }, 'booking_intent_extraction_failed');
    await writeAiLog(businessId, sessionId, { historyCount: history.length }, null, latencyMs, code);
    return saveReply(businessId, userId, sessionId, title, previous, 'The assistant is unavailable right now. Use the manual booking form below to continue; your message has been saved.', 'show_form');
  }

  const { intent, provider, model } = extractedDetails;

  // 4. Treat an AI confirmation classification as a request for explicit user confirmation only.
  if (previous?.startsAt && previous.serviceId && intent.isConfirmation) {
    const decision = bookingConfirmationDecision(content, intent.isConfirmation);
    if (decision === 'ask_for_confirmation') {
      return saveReply(businessId, userId, sessionId, title, previous,
        'Please reply “Yes, confirm booking” if you want me to book this appointment.', 'ask_more',
        { quickReplies: ['Yes, confirm booking', 'Choose another time'], provider, model });
    }
  }

  // 5. Update booking state from extracted values
  const incomingTime = parseTimeFromText(content);
  const serviceName = intent.serviceName ?? previous?.serviceName ?? null;
  const date = intent.date ?? previous?.date ?? null;
  const time = incomingTime ?? intent.time ?? previous?.time ?? null;

  const service = previous?.serviceId
    ? services.find((item) => item.id === previous.serviceId) ?? null
    : services.find((item) => item.name.toLowerCase() === serviceName?.toLowerCase()) ?? null;

  const draft: PendingBooking = {
    ...(service ? { serviceId: service.id, serviceName: service.name } : serviceName ? { serviceName } : {}),
    ...(date ? { date } : {}),
    ...(time ? { time } : {}),
  };

  // 6. Ask for missing information
  if (serviceName && !service) {
    return saveReply(businessId, userId, sessionId, title, draft, `I couldn't find a service called "${serviceName}". Available services are: ${names.join(', ')}. Which one would you prefer?`, 'ask_more', { provider, model });
  }
  if (!service) {
    return saveReply(businessId, userId, sessionId, title, draft, `Which service would you like to book? Available services: ${names.join(', ')}.`, 'ask_more', { provider, model, quickReplies: names });
  }
  if (!date) {
    return saveReply(businessId, userId, sessionId, title, draft, `What date or weekday would you prefer for your ${service.name}?`, 'ask_more', { provider, model, quickReplies: ['Tomorrow', 'Next Monday'] });
  }
  if (!time) {
    const localDay = DateTime.fromISO(date, { zone: business.timezone }).toFormat('ccc, dd LLL');
    return saveReply(businessId, userId, sessionId, title, draft, `What time works best for you on ${localDay}? Our hours are Monday–Friday, 09:00–17:00.`, 'ask_more', { provider, model });
  }

  // 7. Validate business rules and timing
  let startsAt: Date;
  try {
    startsAt = localSlotToUtc(date, time, business.timezone);
    assertOfferedSlot(startsAt, service.duration_minutes, business.timezone);
  } catch (error) {
    const message = error instanceof HttpError ? error.message : 'Please choose a valid weekday and time between 09:00 and 17:00.';
    return saveReply(businessId, userId, sessionId, title, { serviceId: service.id, serviceName: service.name, date }, message, 'ask_more', { provider, model });
  }

  // 8. Check PostgreSQL availability
  const available = await getAvailability(businessId, service.id, date);
  if (!available.slots.includes(startsAt.toISOString())) {
    return freeTimeReply(businessId, userId, sessionId, title, { serviceId: service.id, serviceName: service.name, date }, business.timezone, provider, model);
  }

  // 9. Slot is available: request explicit confirmation
  const pending: PendingBooking = { serviceId: service.id, serviceName: service.name, date, time, startsAt: startsAt.toISOString() };
  const local = DateTime.fromJSDate(startsAt, { zone: 'utc' }).setZone(business.timezone);
  const reply = `I found a free ${service.name} on ${local.toFormat('ccc, dd LLL')} at ${local.toFormat('h:mm a')} (${business.timezone}). Reply “Yes, confirm booking” to book it.`;
  return saveReply(businessId, userId, sessionId, title, pending, reply, 'suggest_slots', { quickReplies: ['Yes, confirm booking', 'Choose another time'], provider, model });
}
