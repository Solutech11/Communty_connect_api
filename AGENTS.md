# Community Connect Backend Agent Guide

This directory is the TypeScript, Express, MongoDB, Redis, Socket.IO, and third-party integration backend for Community Connect. The conventions below are durable and apply to every file under `backend/`.
The reference to the frontend: C:\Users\Solutech\Documents\Lincoln\LincolnFinalyrEventapp\community_connect
make sure most or any api you doing coordinates with the frontend here so go through the frontend to know the kind of endpoint, response to give.

## Reference Style

This structure intentionally combines the strongest conventions observed in the owner's existing Savvy Bee, Propfizer, and ErrandPal APIs:

- Keep `app.ts` as the single Express composition and process/network bootstrap, matching the owner's preferred APIs.
- Keep route trees in `router/`, Mongoose documents in `models/`, shared integrations in `utils/`, connection code in `DB/`, and domain orchestration in `Controller/`.
- Use a small route aggregator per domain and a root route aggregator.
- Keep route files thin: validation, authentication/authorization middleware, then controller functions.
- Group models and routes by domain instead of placing unrelated files together.
- Include the failing operation/location when logging caught errors, while never returning internal error details to clients.

Unlike the older CommonJS projects, all new code here must be strict TypeScript and use `async`/`await`.

## Required Structure

```text
backend/
  app.ts                  Express composition, Mongo/Redis connect, HTTP/Socket start, graceful shutdown
  Community_AI/           Groq client and event recommendation algorithms
  Config/                 Typed environment and Swagger configuration
  Constant/               Stable enums and constants
  Controller/             Functional domain use cases and orchestration
  Cron/                   Redis-locked reconciliation and maintenance jobs
  DB/                     MongoDB and Redis clients
  Socket/                 Authenticated Socket.IO gateway
  docs/                   Endpoint registry and OpenAPI document
  middleware/             Auth, authorization, validation, rate limits, errors
  models/<domain>/        Mongoose schemas and models
  router/<domain>/        REST route aggregators
  schemas/                Reusable Zod schemas
  scripts/                Project checks and maintenance scripts
  types/                  Express and shared TypeScript declarations
  utils/                  Reusable infrastructure clients/helpers
  tests/                  Unit and integration tests
```

## Security Is Not Optional

- Never hard-code, commit, print, or expose API keys, passwords, JWT secrets, Cloudinary credentials, Paystack keys, mail tokens, encryption keys, or `.env` contents.
- Do not copy credentials found in any reference repository. All secrets must come from validated environment variables.
- Authenticate every protected route with the shared access-token middleware.
- Apply role checks and resource ownership checks independently; authentication alone is not authorization.
- Validate `body`, `params`, and `query` with Zod before a controller runs.
- Money-changing routes require an `Idempotency-Key`, Redis locking, integer minor units (kobo), database transactions, ownership checks, and an audit transaction record.
- Treat Paystack responses and webhooks as untrusted input. Verify the HMAC-SHA512 webhook signature before processing and deduplicate events/references.
- Never credit a wallet from a client callback alone. Reconcile through a verified Paystack response or signed webhook.
- Store refresh tokens only as hashes. Rotate refresh tokens on every refresh and revoke a token family when reuse is detected.
- Encrypt sensitive bank fields with AES-256-GCM. Never return full account numbers.
- Do not log request authorization headers, cookies, tokens, passwords, OTPs, account numbers, message content, or raw webhook bodies.
- Use constant-time comparisons for signatures and token hashes where practical.
- Uploads must use memory storage, strict MIME allowlists, size limits, authenticated ownership, and Cloudinary server-side credentials.
- `Alert.alert` and frontend conventions do not apply here; use the shared API error format.

## Coding Rules

- Use Yarn for all dependency and script commands.
- Use TypeScript for every new source file.
- Use `async`/`await`; do not add callback-style application code.
- Keep code readable and formatted. Do not compress logic into one-line statements.
- Use comments to explain security invariants, financial state transitions, non-obvious queries, and third-party behavior. Avoid comments that merely repeat code.
- Controllers should call reusable services/utilities instead of duplicating integration logic.
- Use the shared `AppError`, async handler, response helpers, logger, authentication, authorization, validation, and rate-limit middleware.
- API responses must not expose stack traces, raw database errors, provider secrets, or internal model fields.
- Add indexes for ownership, lookup, idempotency, TTL, and unique constraints when adding a model.

## REST and Documentation Rules

- Use plural, resource-oriented REST paths under `/api/v1`.
- Every new or changed endpoint must be added to `docs/endpoint-registry.ts`.
- Swagger at `/api/docs` is generated from that registry. Keep request/response schemas useful, not just a summary.
- Also update the endpoint table in `README.md` so GitHub users can discover the API without running the server.
- Run `yarn docs:check` to detect route/documentation drift.

## Required Verification

Before handing off backend work, run:

```bash
yarn typecheck
yarn test
yarn docs:check
yarn build
```

If an integration cannot be exercised because credentials, a Mongo replica set, Redis, Paystack webhook registration, or an external dashboard setting is missing, state that clearly. Never weaken a security check to make a local demo pass.

## Email Design and Implementation

Every new or updated backend email MUST follow the shared Community Connect email layout. Do not create one-off raw HTML layouts in controllers or services. Use `utils/emailTemplate.utils.ts` (`renderBrandedEmail` and its content helpers) for a consistent branded header, single-column card, readable hierarchy, generous spacing, and clear footer. If the shared layout needs to change, update the shared renderer so all mail stays consistent.

Email layout requirements:

- Design for narrow mobile screens first, then desktop. Keep the message to one column, use responsive widths, readable body text, and comfortable spacing.
- Use semantic table-based structure and inline styles for broad email-client support. Keep essential content visible when images or remote styles are blocked; any added image must include useful alt text.
- Add a concise preheader that complements the subject. Put the reason for the message first, then the details and the next step. Keep one clear, relevant call to action when a valid destination is available; make its tap target at least 44 by 44 pixels.
- Use the Community Connect green and warm-gold brand treatment, high-contrast text, and a restrained palette. Keep transactional emails focused on the event, account action, payment, or notification that caused them; do not add unrelated promotion.
- Escape every dynamic value before inserting it into HTML. Keep OTPs, payment details, and account data out of logs. Send both HTML and a readable plain-text alternative.
- Include only footer information that is accurate for that message. Do not invent support addresses, unsubscribe flows, URLs, or deep links.

Use these email-design references as inspiration when changing the shared layout:

- [Mailchimp transactional email guidance](https://mailchimp.com/resources/transactional-email-examples/)
- [Mailchimp mobile-friendliness reference](https://templates.mailchimp.com/design/mobile-friendliness/)
- [Mailchimp email accessibility guidance](https://mailchimp.com/resources/accessibility-in-email-marketing/)
- [Mailchimp layout and visual hierarchy guidance](https://mailchimp.com/resources/best-email-layout/)
