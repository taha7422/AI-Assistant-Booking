# Local PostgreSQL setup

## Application database

Install PostgreSQL with `pgcrypto` and `btree_gist` available. Create an application role and database in pgAdmin or `psql`; keep the password local and URL-encode reserved characters in `DATABASE_URL`.

Copy `.env.example` to `.env`, then set `DATABASE_URL`, a private `JWT_SECRET` of at least 32 characters, `AI_PROVIDER=groq`, `GROQ_API_KEY`, `GROQ_MODEL`, `FRONTEND_ORIGIN`, and `NODE_ENV=development`. Keep `TRUST_PROXY_HOPS=0` for direct local access. For offline local development, set `AI_PROVIDER=mock` and leave `GROQ_API_KEY` blank.

Run from the repository root:

```powershell
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

The API health endpoint is `http://127.0.0.1:4000/health`; the Next.js frontend is `http://127.0.0.1:3000`. The seed inserts the default business and sample services. Migrations are tracked and safe to rerun.

## Disposable test database

Create a separate, empty local database named with the `_test` suffix, such as `ai_assistant_booking_test`. Never point this suite at the application database or production. Set the URL only in the shell running the tests:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://test_user:local_test_password@127.0.0.1:5432/ai_assistant_booking_test'
npm run test:postman
npm run test:integration
```

The runner rejects non-loopback hosts, database names without `_test`, and databases containing user or appointment rows. It migrates and seeds the designated test database, starts a separate API process with mock extraction and a temporary JWT secret, runs the test suite, then removes test-created accounts. It does not read `DATABASE_URL` for test execution, access Groq, or delete database tables.

Use the test PostgreSQL role with permissions limited to that disposable database. Keep both database URLs and passwords out of source control and chat.
