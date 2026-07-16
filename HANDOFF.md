# Community Connect Backend Handoff

## Current State

The backend is a standalone Yarn project and is ready to be moved out of the Expo repository. It does not import source files, configuration, or dependencies from the mobile app.

The API includes 77 documented REST endpoints for authentication, users, devices, events, tickets, communities, friends, chat, AI, notifications, disputes, wallet operations, Paystack pay-ins/payouts/webhooks, uploads, and administrative flows.

## Development Command

```bash
yarn dev
```

This now starts **nodemon**. The behavior is defined in `nodemon.json`:

```text
nodemon -> tsx app.ts
```

There is no Vite or Vitest dependency. Tests use Node's built-in test runner.

Production commands remain:

```bash
yarn build
yarn start
```

## Socket.IO Structure

The realtime bootstrap follows the same arrangement used in the supplied reference APIs:

```text
app.ts
  -> const server = app.listen(...)
  -> Socket(server)
  -> Socket/Socket.ts
  -> Socket/routes/Chat.Socket.ts
```

Chat clients connect to the `/chat` namespace and send the access token through:

```ts
io(`${API_URL}/chat`, {
  auth: {
    token: accessToken,
  },
});
```

Supported client events:

- `join-chat` or `conversation:join`
- `leave-chat` or `conversation:leave`
- `typing`, `typing:start`, and `typing:stop`

Server events include `socket:ready`, `message:new`, `conversation:read`, and typing updates. Conversation rooms are joined only after a MongoDB participant check. JWT signature, user status, and `tokenVersion` are checked during the socket handshake. Chat message persistence remains on the protected REST endpoint so its Zod validation, idempotency, authorization, and notification behavior stay centralized.

When Redis is available, Socket.IO uses the Redis adapter for multi-instance delivery.

## Move Procedure

1. Stop any running backend process.
2. Copy or move the complete `backend` directory.
3. Exclude `node_modules`, `dist`, logs, and `.env` from the move or deployment artifact.
4. Keep `package.json`, `yarn.lock`, `nodemon.json`, `.env.example`, `AGENTS.md`, source folders, tests, and documentation.
5. In the new location, create `.env` from `.env.example`.
6. Generate new JWT, OTP, and encryption secrets. Do not reuse values from the sample or reference projects.
7. Run `yarn install`.
8. Ensure MongoDB and Redis are running.
9. Run `yarn dev`.
10. Update the Expo app's API URL and Socket.IO host to the backend's new address.

## Required External Setup

- MongoDB; a replica set or Atlas is required for complete transactional wallet behavior.
- Redis for shared rate limits, distributed financial locks, and the Socket.IO adapter.
- Paystack keys, callback URL, and webhook URL.
- Cloudinary account values.
- ZeptoMail send-mail token and verified sender.
- Groq API key.
- Optional Expo enhanced push access token.

Paystack webhook target:

```text
POST https://YOUR_BACKEND_HOST/api/v1/webhooks/paystack
```

Swagger:

```text
GET /api/docs
GET /api/docs.json
```

Health check:

```text
GET /health
```

## Verification at Handoff

Run after moving:

```bash
yarn typecheck
yarn test
yarn docs:check
yarn build
```

Then run `yarn dev` with valid MongoDB, Redis, and `.env` configuration and confirm:

- API startup logs show the configured port.
- `/health` responds successfully.
- `/api/docs` loads.
- An authenticated client connects to `/chat` and receives `socket:ready`.
- Paystack's dashboard can deliver a signed test webhook to the public webhook URL.

## Important Files

- `app.ts`: Express middleware and route composition.
- `app.ts`: database connection, `app.listen`, Socket.IO attachment, cron, and graceful shutdown.
- `Socket/Socket.ts`: Socket.IO server, CORS, JWT authentication, Redis adapter, and namespaces.
- `Socket/routes/Chat.Socket.ts`: authenticated chat room and typing events.
- `router/index.ts`: REST router composition.
- `Config/env.ts`: validated environment configuration.
- `Config/swagger.ts`: Swagger/OpenAPI document.
- `docs/endpoint-registry.ts`: endpoint documentation registry.
- `.env.example`: portable environment template.
- `AGENTS.md`: backend architecture and security rules for future development.
