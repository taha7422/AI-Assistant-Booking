# AI Assistant Booking

A SaaS-style appointment-booking prototype with account-based access, a conversational booking assistant, PostgreSQL persistence, and a manual booking fallback. The assistant uses Groq to extract booking details; application code remains responsible for availability, confirmation, validation, and database writes.

The project demonstrates a complete full-stack workflow for a technical assessment, with emphasis on the core booking experience.

## Features

- Register, sign in, and retrieve the authenticated profile.
- Browse services, check weekday availability, book a time manually, list appointments, and cancel a booking.
- Chat across multiple turns to identify the service, date, and time; the assistant checks availability and requests explicit confirmation before creating an appointment.
- Modify an existing appointment through chat. The backend resolves the authenticated user's booking, asks which one when the request is ambiguous, checks the new slot, and updates the existing row.
- Persist chat sessions, messages, pending booking state, and AI audit metadata in PostgreSQL.
- Use a deterministic mock intent extractor for offline and isolated tests when Groq is unavailable or disabled.
- Responsive sign-in, chat, manual booking, and appointment screens, including narrow-screen layouts.

## Technology

| Area | Implementation |
| --- | --- |
| Frontend | Next.js App Router, React, TypeScript, Tailwind CSS dependency, project CSS styles |
| API | Node.js, Express 5, TypeScript |
| Database | PostgreSQL, parameterized SQL via `pg`, versioned SQL migrations |
| AI | Groq chat completions API with JSON structured output; deterministic mock provider for tests |
| Validation | Zod |
| Authentication | bcryptjs password hashing and signed JWT bearer tokens |
| Logging and HTTP security | Pino, Helmet, CORS allow-list, Express rate limits |
| Testing | Node test runner, `tsx`, Newman/Postman, isolated local PostgreSQL integration harness |

The app is organized as a small monorepo. See [Technical overview](docs/technical-overview.md) for the architecture diagram, API map, data model, workflow details, test evidence, assessment coverage, and limitations.

## Project layout

```text
apps/
  api/                 Express API, middleware, routes, services, repositories, unit tests
  web/                 Next.js frontend
db/
  migrations/          Ordered PostgreSQL migrations
  schema.sql           Current reference schema
  seed.sql             Default business and sample services
docs/                  API, setup, Groq, architecture decisions, technical overview
postman/               YAML source collection/environment and generated exports
scripts/               Isolated Postman and API integration runners
```

## Requirements

- Node.js 20 or newer and npm.
- PostgreSQL 15 or newer with `pgcrypto` and `btree_gist` available.
- A Groq API key for live AI extraction. Local development and automated tests can use mock mode.

## Run locally

From the repository root:

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` locally with your own PostgreSQL URL, a private JWT secret of at least 32 characters, and provider settings. Do not put credentials in Git or documentation. Then initialize and run the app:

```powershell
npm run db:migrate
npm run db:seed
npm run dev
```

The frontend runs at `http://127.0.0.1:3000`; the API runs at `http://127.0.0.1:4000`. The API health endpoint is `http://127.0.0.1:4000/health`. For an offline local run, set `AI_PROVIDER=mock` and leave `GROQ_API_KEY` empty. See [local PostgreSQL setup](docs/local-postgres-setup.md) for database and disposable-test-database setup.

## Environment variables

| Variable | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | API | PostgreSQL connection URL for the application database. |
| `JWT_SECRET` | API | Private signing secret, at least 32 characters; production rejects known placeholder/default values. |
| `AI_PROVIDER` | API | `groq` for live provider calls; `mock` for deterministic local use and tests. Production requires Groq. |
| `GROQ_API_KEY` | API | Server-side secret. Never expose it through a `NEXT_PUBLIC_*` variable. |
| `GROQ_MODEL` | API | Groq model identifier; defaults to `openai/gpt-oss-120b`. |
| `PORT` | API | API listen port; defaults to `4000`. |
| `TRUST_PROXY_HOPS` | API | Number of trusted ingress proxies; defaults to `0`. |
| `FRONTEND_ORIGIN` | API | Exact allowed frontend origin for CORS. |
| `NODE_ENV` | API | `development`, `test`, or `production`. |
| `NEXT_PUBLIC_API_URL` | Frontend build | Public API base URL ending in `/api`. Local loopback hosts default to port 4000. |
| `TEST_DATABASE_URL` | Integration/Postman runner | Empty, disposable loopback PostgreSQL database whose name ends in `_test`. Never point this at an application or customer database. |

The root and API `.env.example` files are examples with placeholders, not credentials. `.env` is ignored by Git. Keep private values out of source control.

## Build and test

```powershell
npm test
npm run build
```

`npm test` runs the API's offline unit tests. `npm run build` builds the API TypeScript and the frontend for production.

The database-backed test commands require a separate, empty local PostgreSQL database ending in `_test`:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://test_user:local_test_password@127.0.0.1:5432/ai_assistant_booking_test'
npm run test:postman
npm run test:integration
```

The sample URL above is illustrative only. Use a local test role and private password. The harness validates the loopback host and `_test` suffix, refuses pre-existing user/appointment rows, starts a separate mock-mode API, and cleans up test accounts. It does not use `DATABASE_URL` or call Groq. **The runner applies migrations and seed data to the designated test database**, so the test database must be disposable; never use an application or customer database. More details are in the [local database guide](docs/local-postgres-setup.md).

### Test evidence and scope

- **Unit tests:** 20 passed, 0 failed, 0 skipped in the most recent observed unit-test run. They cover booking rules, assistant extraction (mock and stubbed Groq HTTP), explicit confirmation, recent chat-history selection, and API error formatting. They do not call a live Groq service or require PostgreSQL.
- **Full isolated integration suite:** The project owner reports the most recent successful run as **51 passed, 0 failed**. This result was not rerun while preparing this documentation. A later local verification could not start the suite because `TEST_DATABASE_URL` was absent and PostgreSQL did not respond at `127.0.0.1:5432`.
- **Postman suite:** The project owner reports an earlier run of **28 requests and 68 assertions** passing. This is a previously reported result, not independently rerun for this documentation; the later local attempt stopped before Newman execution because the isolated test URL was missing.
- **Production builds:** API TypeScript build and frontend production build completed successfully in recent local verification. The combined root build encountered a Windows `EPERM` error in a Next.js generated directory once; the standalone frontend build succeeded on retry.

See [test strategy and assessment coverage](docs/technical-overview.md#testing-and-verification) for the distinction between mock-backed integration checks and real provider verification.

## Assessment coverage

| Assessment requirement | Status | Evidence |
| --- | --- | --- |
| Frontend registration, sign-in, chat, and appointment management | Implemented | `apps/web/app/page.tsx`, `apps/web/app/globals.css` |
| Responsive layout and user feedback states | Implemented; manual device QA remains useful | `apps/web/app/globals.css`, `apps/web/app/page.tsx` |
| REST API for authentication, business, appointments, and chat | Implemented | `apps/api/src/routes/`, `apps/api/src/index.ts` |
| PostgreSQL schema, migrations, relationships, and sample services | Implemented | `db/schema.sql`, `db/migrations/`, `db/seed.sql` |
| Authentication and authorization | Implemented; browser token storage is a production-hardening gap | `apps/api/src/routes/auth.ts`, `apps/api/src/middleware/auth.ts`, `apps/web/app/page.tsx` |
| Multi-turn AI-assisted booking and manual fallback | Implemented; live-provider behavior is separately tested with stubbed HTTP | `apps/api/src/services/assistant.ts`, `apps/api/src/services/chat.ts`, `apps/web/app/page.tsx` |
| Explicit booking confirmation and appointment modification | Implemented | `apps/api/src/services/booking-confirmation.ts`, `apps/api/src/services/chat.ts`, `apps/api/src/services/booking.ts` |
| Availability rules and duplicate/overlap prevention | Implemented in API and PostgreSQL | `apps/api/src/services/booking-rules.ts`, `apps/api/src/services/booking.ts`, `db/schema.sql` |
| Validation, safe errors, logging, and rate limits | Implemented; limits are process-local | `apps/api/src/middleware/`, `apps/api/src/logger.ts`, `apps/api/src/index.ts` |
| Automated test coverage | Implemented; suite results have different evidence levels | `apps/api/src/test/`, `scripts/`, `postman/` |
| Streaming replies, reminders, payments, admin, calendar sync, password reset | Not implemented; outside the core prototype scope | No corresponding UI or API routes. |

Security and privacy follow-up includes moving tokens out of Web Storage, using a shared rate-limit store if horizontally scaled, and defining chat transcript retention and consent.

## Further documentation

- [Technical overview](docs/technical-overview.md) — architecture, workflows, security, database, testing evidence, limitations, and assessment mapping.
- [API reference](docs/API.md) — endpoints, request rules, and errors.
- [Local PostgreSQL setup](docs/local-postgres-setup.md) — local and isolated test database instructions.
- [Groq integration notes](docs/groq-integration.md) — model call and failure behavior.
- [Architecture decisions](docs/decisions.md) — key tradeoffs and design boundaries.
