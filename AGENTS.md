# Community Connect Backend Agent Guide

This directory is the TypeScript, Express, MongoDB, Redis, Socket.IO, and third-party integration backend for Community Connect. The conventions below are durable and apply to every file under `backend/`.

## Reference Style

This structure intentionally combines the strongest conventions observed in the owner's existing Savvy Bee, Propfizer, and ErrandPal APIs:

- Keep `app.ts` as the Express composition root and `server.ts` as the process/network bootstrap.
- Keep route trees in `router/`, Mongoose documents in `models/`, shared integrations in `utils/`, connection code in `DB/`, and domain orchestration in `Controller/`.
- Use a small route aggregator per domain and a root route aggregator.
- Keep route files thin: validation, authentication/authorization middleware, then controller functions.
- Group models and routes by domain instead of placing unrelated files together.
- Include the failing operation/location when logging caught errors, while never returning internal error details to clients.

Unlike the older CommonJS projects, all new code here must be strict TypeScript and use `async`/`await`.

## Required Structure

```text
backend/
  app.ts                  Express app composition only
  server.ts               Mongo/Redis connect, HTTP/Socket start, graceful shutdown
  Config/                 Typed environment and Swagger configuration
  Constant/               Stable enums and constants
  Controller/             Domain use cases and orchestration
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
