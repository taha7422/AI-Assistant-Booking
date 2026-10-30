# AI Assistant Booking API

Local base URL: `http://127.0.0.1:4000`. Successful responses use `{ "data": ... }`; failures use `{ "error": { "code": "...", "message": "...", "details": [...]? } }`. Protected endpoints require `Authorization: Bearer <JWT>`.

## Authentication

- `POST /api/auth/register` (also `/api/auth/signup`) accepts `{ "name", "email", "password" }` and returns `201 { data: { user, token } }`.
- `POST /api/auth/login` accepts `{ "email", "password" }` and returns `{ data: { user, token } }`.
- `GET /api/auth/me` returns the signed-in user's `{ id, name, email }`.

Names must be 2–60 characters. Passwords must include a letter and number, be at least 8 characters, and fit bcrypt's 72 UTF-8 byte limit. Login errors are deliberately generic. Access tokens expire in seven days and contain the user and signed business identifiers.

## Business and appointments

- `GET /api/business` returns the signed-in business timezone, weekday opening hours, slot length, booking window and minimum lead time.
- `GET /api/appointments/services` returns active services in the user's business.
- `GET /api/appointments/availability?serviceId=<uuid>&date=YYYY-MM-DD` returns `{ date, timeZone, slots }`. `date` is a local calendar date in the business timezone; each slot is an ISO timestamp with a UTC offset. The service produces weekday starts every 30 minutes, Monday–Friday 09:00–17:00 local time, no earlier than one hour ahead and no more than 30 days ahead.
- `POST /api/appointments` accepts `{ "serviceId": "<uuid>", "startsAt": "<ISO-8601 timestamp with offset>" }`. The server validates the service, time-zone date, business hours, booking window, offered slot and availability, then inserts a `booked` appointment with `createdVia: "form"`.
- `GET /api/appointments` lists only appointments owned by the current user in the signed business.
- `PATCH /api/appointments/:id/cancel` cancels a booked appointment by changing its status to `cancelled`. Repeated cancellation or a non-owner ID returns not found. `DELETE /api/appointments/:id` remains as a compatibility alias.
- A customer can ask the chatbot to change an existing appointment. The chat resolves the customer's active appointment from the authenticated user and conversation state; it asks for the current date and time when multiple appointments need disambiguation. Availability excludes that appointment while checking, and the update preserves the same database ID. An unavailable slot leaves the row unchanged.

PostgreSQL also rejects overlapping `booked` time ranges per business, protecting against simultaneous requests that race past the application check. Cancelled appointments remain as audit history.

## Persistent assistant conversations

- `POST /api/chat/sessions` creates a session and initial assistant message; an optional body may contain `{ "title": "..." }`.
- `GET /api/chat/sessions` lists the signed-in user's recent sessions.
- `GET /api/chat/sessions/:id` returns the session's persisted messages and action metadata. A different user's session appears as not found.
- `POST /api/chat/sessions/:id/messages` accepts `{ "content": "..." }` (1–500 characters). A shared per-user throttle covers this endpoint and the stateless assistant endpoint: six chat POSTs per minute. Messages and structured action metadata are persisted. Model-derived replies identify `provider: "groq"`; deterministic local responses identify `provider: "mock"`. The AI only extracts intent. The application matches the service against PostgreSQL, converts local date/time, checks authoritative availability, and asks for explicit confirmation. A clear confirmation uses the booking service; a modification uses the update service and returns action `modified` only after the row update succeeds. The AI never writes directly to PostgreSQL or claims an appointment succeeded.

The assistant may return `ask_more`, `suggest_slots`, `booked`, `modified` or `show_form`. Groq timeouts, invalid model output, missing configuration, or an unavailable provider produce a manual-form fallback; the manual endpoint works independently. Check `data.action` and `data.message.metadata.provider` to distinguish a fallback from a provider response. Groq requests have a 10-second timeout and one HTTP attempt; failures are not automatically retried. Only the latest six messages (maximum 500 characters each) are sent. Logs include safe provider error codes, not API keys, raw provider messages or prompt text. Chat messages themselves are stored in PostgreSQL and require a retention policy.

## Common errors

- `VALIDATION_ERROR` — invalid request schema.
- `AUTH_REQUIRED`, `INVALID_TOKEN`, `INVALID_CREDENTIALS` — missing or invalid authentication.
- `EMAIL_EXISTS` — sign up with an existing account; sign in instead.
- `SERVICE_NOT_FOUND`, `INVALID_DATE`, `CLOSED_DAY`, `OUTSIDE_OPERATING_HOURS`, `BOOKING_TOO_SOON`, `BOOKING_TOO_FAR`, `INVALID_SLOT_ALIGNMENT` — booking rules rejected the request.
- `SLOT_TAKEN` — another booking overlaps the selected time; choose a new slot.
- `APPOINTMENT_NOT_FOUND`, `CHAT_SESSION_NOT_FOUND` — missing resource or ownership mismatch.
- `RATE_LIMITED`, `CHAT_RATE_LIMITED` — global/API or per-user chat limit reached.

The API applies a global 100-request/minute limiter, a 10-attempt/15-minute sign-up/login limiter per IP, and the shared six-chat-POST/minute limiter per authenticated user. The chat limiter uses the process-local memory store; a horizontally scaled production deployment should use a shared rate-limit store. Set `TRUST_PROXY_HOPS` to the exact number of trusted ingress proxies so IP-based limits use the client address. Neither access tokens nor request bodies or raw provider errors are written to Pino logs. AI audit rows contain aggregate request metadata and parsed intent, not the sent conversation history.
