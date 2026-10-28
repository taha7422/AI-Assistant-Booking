# Decisions and plan-alignment notes

Reviewed `Assessment_Execution_Plan.docx` from the user's Downloads folder on 2026-10-29. Its text, tables, and all six embedded visuals were inspected. The separate official assessment brief was not present in the project workspace.

## Current choices

- Keep **AI Assistant Booking** as the application name. The plan's mockups use “Slotly,” but the project instructions designate AI Assistant Booking as the official name.
- Keep manual booking independent of the assistant. The current assistant only extracts a service/date/time and does not write appointments. This is a safe boundary, but it does not yet satisfy the plan's P0 requirement that chat use the same booking service and finish bookings through that service.
- The schema uses a PostgreSQL GiST exclusion constraint over overlapping confirmed time ranges. This is broader than an exact unique start-time index and prevents partial overlaps, but currently applies globally because no business/provider resource table exists.
- UTC is used provisionally. The plan explicitly asks for an IANA timezone stored on a `businesses` record and daylight-saving-aware slot conversion; this remains unimplemented.
- The plan names `mistral-small-latest`; the code currently defaults to configurable `mistral-medium-3.5` pending confirmation of an account-enabled model and the missing brief. No Mistral key was available for a live request.
- The design uses the required official application name, but current styling is not the plan's indigo palette and the page structure is not the split-screen auth / separate Chat and Appointments mockup. Redesign to the plan tokens before calling the UI plan-compliant.

## Material plan gaps

- No `businesses` table or `business_id` foreign keys; no business timezone field.
- No persisted chat sessions or messages, AI call log rows, session ownership endpoints, or `/api/auth/me`.
- Chat does not generate suggestions from authoritative slot availability or create appointments through the shared booking service. It currently returns a validated intent and points users to the manual form.
- No Mistral request timeout/retry, relative-date resolution, AI latency/request/response audit log, or 500-character user text limit from the plan.
- API paths and errors differ from the plan: registration uses `/api/auth/register` rather than `/signup`; cancellation uses DELETE rather than PATCH `/cancel`; success/error JSON does not use the plan's full `error.code` and `error.message` shape.
- Current sample services and signup/password rules differ from the plan's examples and UI rules. Terms acceptance, password show/hide, and split-screen branding are absent.
- The plan's endpoint contract and the assessment prompt's general requirements should be reconciled before locking the final API.

## Verification and access

- `npm.cmd run build`: passed for API and web at last verification.
- `npm.cmd test`: passed 6 appointment-rule unit tests. There are no database integration/concurrency/auth/parser tests yet.
- `npm update postcss` reported 0 vulnerabilities after a PostCSS override; repeated standalone `npm audit` calls intermittently failed to contact the npm advisory endpoint.
- PostgreSQL Windows service reports running, but the execution shell was denied TCP access to localhost:5432. The schema/seed and real account → booking → list → cancellation flow therefore remain unverified.
- No hosting account or approved public deployment target was available. No public deployment or GitHub push was performed.
