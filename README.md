# AI Assistant Booking

A full-stack appointment scheduler with protected user accounts, an AI-assisted intake chat, a deterministic manual booking flow, and PostgreSQL-backed bookings. The attached `Assessment_Execution_Plan.docx` was later located in Downloads and inspected, including its tables and six embedded diagrams/mockups. The separate official assessment brief has not been located. The current code began before the plan was found and is only a partial implementation; plan-specific differences are recorded in `docs/decisions.md`.

## Architecture

- `apps/web`: Next.js App Router, React, TypeScript, Tailwind CSS. One responsive screen provides sign-up/sign-in, chat, manual availability lookup, booking list, and cancellation.
- `apps/api`: Express 5 and TypeScript. Zod validates HTTP and AI inputs/outputs; bcrypt hashes passwords; JWT protects user resources; Helmet, CORS, rate limiting, Pino HTTP logging, and centralized errors are enabled.
- `db/schema.sql`, `db/seed.sql`: PostgreSQL schema and starter service rows. A GiST exclusion constraint on confirmed appointment time ranges prevents overlapping bookings at the database layer. An application check provides a clearer early conflict response.
- The AI extracts service/date/time and asks questions. It has no booking write tools. A user must use the appointment endpoint/form to submit a booking; the server then checks service, operating hours, future time, and collisions.

The API response convention is `{ "data": ... }` for successful operations and `{ "error": "..." }` for failures. The frontend currently keeps the JWT in local storage for this assessment prototype; a production deployment should use secure, HttpOnly, SameSite cookies and a CSRF strategy.

## Provisional assumptions and decisions

- Services seeded: Consultation (30 minutes), Follow-up (20 minutes), Extended session (60 minutes). These are sample values; the plan's examples include Consultation, Check-up, and Follow-up.
- Hours: Monday through Friday, 09:00–17:00 UTC, with half-hour starts. The plan calls for a configured IANA business time zone stored on a business record. UTC is a temporary simplification, not full compliance with that requirement.
- AI model is configurable via `MISTRAL_MODEL`, defaulting to `mistral-medium-3.5`. The plan specifies `mistral-small-latest`; the default here is a provisional provider-documented alternative and has not been tested with an account key. Change it after confirming the account-enabled model ID.
- The API uses the official `@mistralai/mistralai` TypeScript SDK and chat completions. No key means a deterministic mock assistant is used for development. Provider or output-validation errors return a manual-booking fallback.
- Appointment statuses are `confirmed` and `cancelled`; cancellation updates the record, preserving audit history.

## Local setup

Requirements: Node.js 20.9+ (the installed machine reported Node v26.13.0), npm, and PostgreSQL. This machine reports PostgreSQL 18.6 and a running Windows service, but the execution environment denied a TCP connection to localhost:5432. The Git repository was initialized locally. PowerShell blocks the `npm` script shim under the current execution policy, so run `npm.cmd` commands.

1. Create a database named `ai_assistant_booking` and a PostgreSQL role with permissions to create the `pgcrypto` and `btree_gist` extensions (or have an administrator install them).
2. Copy the root `.env.example` to root `.env` and set `DATABASE_URL` and a random `JWT_SECRET` of at least 32 characters. Keep `MISTRAL_API_KEY` empty for mock mode, or enter it directly in that local environment file; never paste it into chat or commit it. `MISTRAL_MODEL` is configurable.
3. From the repository root, run `npm.cmd install`, then `npm.cmd run db:migrate` and `npm.cmd run db:seed`.
4. Run `npm.cmd run dev`. The API is at `http://localhost:4000`; Next.js is at `http://localhost:3000`.
5. Check `http://localhost:4000/health` after PostgreSQL access is configured.

The migration runner reads the root SQL files; the schema may also be applied directly with `psql -d ai_assistant_booking -f db/schema.sql` followed by `-f db/seed.sql`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | API listen port (default 4000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret; use a unique random value of at least 32 characters |
| `MISTRAL_API_KEY` | Optional server-only Mistral API key; omitted means mock mode |
| `MISTRAL_MODEL` | Model identifier (default `mistral-medium-3.5`) |
| `FRONTEND_ORIGIN` | Exact allowed web origin (default `http://localhost:3000`) |
| `NODE_ENV` | `development`, `test`, or `production` |
| `NEXT_PUBLIC_API_URL` | Optional frontend API base URL (default `http://localhost:4000/api`) |

Do not expose DB credentials, JWT signing key, or the Mistral key to `NEXT_PUBLIC_*` values. Production deployment must reject development secrets and enforce HTTPS, restricted CORS, secrets-manager configuration, backups, and database connection controls.

## API

All paths below are relative to `http://localhost:4000`.

- `GET /health` — database-backed health check.
- `POST /api/auth/register` — `{ name, email, password }`, password length 10–128 characters and at most 72 UTF-8 bytes (bcrypt limit). Returns user and 7-day JWT.
- `POST /api/auth/login` — `{ email, password }`. Returns user and JWT.
- `GET /api/appointments/services` — active service list; requires `Authorization: Bearer <token>`.
- `GET /api/appointments/availability?serviceId=<uuid>&date=YYYY-MM-DD` — available 30-minute starts; requires auth.
- `POST /api/appointments` — `{ serviceId, startsAt }` ISO timestamp with offset; requires auth. Returns the persisted appointment.
- `GET /api/appointments` — current user's appointments only; requires auth.
- `DELETE /api/appointments/:id` — cancel a confirmed appointment belonging to the current user; requires auth.
- `POST /api/assistant/chat` — `{ messages: [{ role: "user"|"assistant", content }] }`, 1–12 entries. Returns a validated reply and non-authoritative extracted intent; requires auth.

The API applies a global request limit and a stricter per-IP limit of 10 sign-up/sign-in requests per 15 minutes.

## Database migrations and booking correctness

`db/schema.sql` is the current baseline schema and is safe to apply on a clean database. `db/migrations/001_initial.sql` mirrors the baseline. `npm.cmd run db:migrate` applies it, and `npm.cmd run db:seed` inserts sample services idempotently. In a production system, migrations should be versioned and tracked by an explicit migration table; the current runner is intentionally small for an empty assessment project.

The exclusion constraint rejects overlapping active appointments even if two requests race past the application availability check. Its current scope is global across all users because the provisional model represents one shared appointment resource. If multiple staff/providers are required, the brief must specify resources and the constraint should include a provider/resource ID.

## Testing

Run `npm.cmd test` for API unit tests and `npm.cmd run build` to compile both workspaces. The database-backed booking flow still requires a successful local PostgreSQL connection. Do not treat a passing compile or unit test as proof of an end-to-end persisted booking until register → availability → create → list → cancel has been exercised against PostgreSQL.

## Deployment

No hosting account, managed database credentials, Mistral key, or deployment connector was confirmed in this environment, and public publication requires your approval. No deployment has been attempted. A compatible deployment layout is a Next.js host, a Node.js service host for Express, and managed PostgreSQL. Configure the API's `DATABASE_URL`, `JWT_SECRET`, optional `MISTRAL_API_KEY`, `MISTRAL_MODEL`, and exact `FRONTEND_ORIGIN`; set `NEXT_PUBLIC_API_URL` to the deployed API origin plus `/api`. Keep the database private and use TLS. Deployment steps must be adapted to the actual providers/accounts and verified before any live-demo claim.

## Known limitations

The official assessment brief itself has not been located. The implementation also does not yet meet several explicit execution-plan goals: there is no `businesses` table or `business_id` scoping, business IANA time zone or daylight-saving handling, persisted chat sessions/messages, AI-call audit table/log rows, `/api/auth/me`, or plan-shaped chat-session endpoints/error codes. The AI chat gathers intent and displays a manual form, but does not yet complete a booking through the shared booking service. The current UI is a single-page blue layout rather than the plan's split-screen indigo auth and separate Chat/Appointments views. There is no provider/staff resource, email verification, password reset, refresh-token/session revocation, or automated production migration tracking. The browser keeps chat history only in memory and the JWT in local storage. PostgreSQL-backed end-to-end booking, concurrency tests, and deployment remain unverified.

## Interview-ready decisions

Be prepared to explain the split between conversational intent extraction and deterministic booking commands; why a database exclusion constraint is required in addition to an application pre-check; and why every appointment read/update is scoped to the authenticated user. Before submission, reconcile the missing `business_id`/tenant design, plan timezone, chat persistence and AI logs, chat-driven booking, response contract, UI tokens, and chosen Mistral model against the plan and official brief.
