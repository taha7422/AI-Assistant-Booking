import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingConfirmationDecision, createBookingOnExplicitConfirmation } from '../services/booking-confirmation.js';

test('explicit confirmation creates the proposed appointment', async () => {
  let createCalls = 0;
  const appointment = { id: 'appointment-1' };
  const result = await createBookingOnExplicitConfirmation('Yes, confirm booking', async () => {
    createCalls += 1;
    return appointment;
  });

  assert.deepEqual(result, { action: 'created', appointment });
  assert.equal(createCalls, 1);
});

test('ambiguous messages do not create an appointment', async () => {
  let createCalls = 0;
  const result = await createBookingOnExplicitConfirmation('Is 4 PM okay?', async () => {
    createCalls += 1;
    return { id: 'appointment-1' };
  });

  assert.deepEqual(result, { action: 'not_confirmed' });
  assert.equal(createCalls, 0);
});

test('negative responses do not create an appointment', async () => {
  let createCalls = 0;
  const result = await createBookingOnExplicitConfirmation('No', async () => {
    createCalls += 1;
    return { id: 'appointment-1' };
  });

  assert.deepEqual(result, { action: 'not_confirmed' });
  assert.equal(createCalls, 0);
});

test('an AI false-positive confirmation asks the user and cannot create an appointment', async () => {
  let createCalls = 0;
  const decision = bookingConfirmationDecision('I am not sure yet.', true);
  const result = await createBookingOnExplicitConfirmation('I am not sure yet.', async () => {
    createCalls += 1;
    return { id: 'appointment-1' };
  });

  assert.equal(decision, 'ask_for_confirmation');
  assert.deepEqual(result, { action: 'not_confirmed' });
  assert.equal(createCalls, 0);
});
