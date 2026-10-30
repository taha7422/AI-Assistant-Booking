# Architecture decisions

- **Provider:** Groq is the sole hosted model provider. Mock extraction exists only for deterministic local development and tests. AI extracts intent; application services validate and persist bookings.
- **Tenant scope:** Users, services, appointments, chat sessions and AI audit records are scoped to a business. The seed creates one default business.
- **Time rules:** Appointments use the business IANA timezone, weekdays 09:00–17:00, 30-minute start increments, at least one hour of lead time and a 30-day booking horizon.
- **Booking safety:** Both chat and manual bookings use backend availability checks. PostgreSQL enforces non-overlap with an exclusion constraint. Chat changes resolve the authenticated user's active appointment and update that row.
- **Persistence:** Chat messages and action metadata are stored in PostgreSQL. Define transcript retention and user notice before real customer deployment.
- **Authentication:** Passwords use bcrypt; signed, issuer-checked JWTs scope requests to user and business. The frontend currently stores the bearer token in Web Storage; moving to secure HttpOnly cookies with CSRF protection is recommended before public production use.
- **Postman source:** Ordered YAML files are the source of truth. The runner produces the two Postman JSON variants and a docs export; the duplicate exports support existing import paths.
- **Test isolation:** Postman and integration runners require `TEST_DATABASE_URL` for an empty loopback PostgreSQL database ending in `_test`. They start a separate mock-mode API and never use the application database URL or Groq.

See the [API reference](API.md), [local database setup](local-postgres-setup.md), and [Groq notes](groq-integration.md).
