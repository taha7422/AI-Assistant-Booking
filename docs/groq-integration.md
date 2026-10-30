# Groq integration

Groq is the only hosted AI provider. The API calls the OpenAI-compatible chat completions endpoint from `apps/api/src/services/assistant.ts`, sends the configured model and a JSON response format, and keeps the key on the server. The model extracts booking intent; backend validation, availability, confirmation and persistence remain authoritative.

The configured model defaults to `openai/gpt-oss-120b`. Provider requests have a 10-second timeout and are not automatically retried. HTTP 429 errors are classified as `GROQ_RATE_LIMIT`; other HTTP, network, timeout, empty-response and invalid-JSON failures go through the manual-booking fallback. Provider error text is not returned to customers or written to logs.

`AI_PROVIDER=mock` enables deterministic local extraction and tests. Production startup rejects mock mode and requires `GROQ_API_KEY`. Unit tests stub `fetch` to verify the Groq request shape and error handling without contacting the provider. The isolated Postman and integration runners use mock mode, so they do not use provider quota.

Keep `GROQ_API_KEY` only in a secret manager or ignored local `.env`. Never place it in Postman exports, frontend `NEXT_PUBLIC_*` variables, logs, or example configuration files. If a real key was exposed in an environment example or Git history, revoke it and issue a replacement.
