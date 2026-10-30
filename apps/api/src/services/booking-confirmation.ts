const explicitConfirmationPattern = /^(?:yes|y|confirm|confirm booking|yes[,! ]+confirm(?: booking)?|yes[,! ]+book(?: it)?|book it|sounds good)\.?$/i;

export type BookingConfirmationDecision = 'confirmed' | 'ask_for_confirmation' | 'not_confirmation';

export function bookingConfirmationDecision(userMessage: string, aiSaysConfirmed = false): BookingConfirmationDecision {
  if (explicitConfirmationPattern.test(userMessage.trim())) return 'confirmed';
  if (aiSaysConfirmed) return 'ask_for_confirmation';
  return 'not_confirmation';
}

export async function createBookingOnExplicitConfirmation<T>(
  userMessage: string,
  createBooking: () => Promise<T>,
): Promise<{ action: 'created'; appointment: T } | { action: 'not_confirmed' }> {
  if (bookingConfirmationDecision(userMessage) !== 'confirmed') return { action: 'not_confirmed' };
  return { action: 'created', appointment: await createBooking() };
}
