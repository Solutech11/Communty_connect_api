# Reference Backend Architecture Study

This backend was designed after read-only review of the owner's Savvy Bee, Propfizer, and ErrandPal APIs. No secrets, credentials, service-account files, or environment values were copied.

## Patterns Preserved

- Root application composition (`app.ts`/`app.js`) mounts domain route aggregators.
- Routes are grouped by actor or business domain and use small nested aggregators.
- Shared authentication, encryption, mail, Cloudinary, notification, and provider behavior lives in `utils/`.
- Mongoose schemas live in domain folders under `models/`.
- Realtime behavior is isolated in `Socket/`; recurring reconciliation is isolated in `Cron/`.
- Catch blocks log the failed operation/location, while clients receive a stable error shape.
- Yarn is the dependency and script runner.

## Improvements Applied Here

- Strict TypeScript and `async`/`await` throughout instead of mixed CommonJS JavaScript.
- Thin routers, reusable Zod validation, controller orchestration, and shared provider clients.
- One access-token middleware, role middleware, ownership checks, and optional auth for public/private detail routes.
- Rotating hashed refresh tokens with family replay detection and access-token invalidation through `tokenVersion`.
- Redis-backed rate limits and distributed locks rather than per-process financial protection.
- Integer-kobo ledgers, idempotency keys, Mongo transactions, exact amount verification, reserved ticket inventory, and signed/deduplicated webhooks.
- AES-256-GCM for bank and QR secrets plus response redaction for internal provider fields.
- A canonical endpoint registry used by Swagger plus a drift-check script and GitHub-readable endpoint catalog.
- Structured redacted Pino logging and production startup rejection for placeholder secrets.

## Deliberately Not Copied

- Hard-coded provider credentials or URLs containing secrets.
- Large route handlers that mix validation, authorization, provider calls, and database orchestration in one function.
- Client-controlled payment amounts or wallet credits.
- Default alert/error payloads that expose stack traces, raw database errors, or internal credentials.
- Unauthenticated Socket.IO room joins or unverified webhook state changes.
