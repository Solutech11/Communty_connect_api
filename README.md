# Community Connect Backend

Production-oriented Node.js/TypeScript backend for the Community Connect Expo app. It follows the owner's established `app -> router -> controller/utils -> model` style while adding strict typing, reusable validation, route-level authorization, token rotation, financial idempotency, and centralized OpenAPI documentation.

## Stack

- Node.js 20+, TypeScript, Express 5
- MongoDB/Mongoose and Redis
- JWT access tokens and rotating hashed refresh tokens
- bcrypt password hashing and AES-256-GCM sensitive-field encryption
- Paystack payments, transfers, payout webhooks, and account resolution
- Groq API for low-cost assistant, event-copy, and chat-summary features
- Socket.IO with a Redis adapter for realtime chat/presence
- Expo Push Service, Cloudinary, and ZeptoMail
- Zod, Helmet, CORS allowlists, HPP, rate limiting, slowdown, body limits, and Pino redaction
- Swagger/OpenAPI 3.1 at `/api/docs`

## Quick Start (Yarn)

```bash
cd backend
copy .env.example .env
yarn install
yarn dev
```

Before starting, replace every placeholder in `.env`. Use independent random secrets. Generate the field-encryption key with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Required local services:

1. MongoDB. Wallet transfers use Mongo transactions, so production and full financial-flow testing require a replica set or MongoDB Atlas.
2. Redis. Financial routes fail closed when a distributed lock cannot be acquired.
3. Provider credentials and configured dashboard settings for Paystack, Cloudinary, ZeptoMail, OpenAI, and Expo enhanced push security if enabled.

## Commands

```bash
yarn dev          # nodemon development server (executes tsx app.ts)
yarn typecheck    # strict TypeScript validation
yarn test         # unit tests
yarn docs:check   # route count and endpoint registry drift check
yarn build        # production build to dist/
yarn start        # start compiled build
```

## API Conventions

- Base path: `/api/v1`
- Authentication: `Authorization: Bearer <accessToken>`
- Money: integer **kobo**, never floating-point naira
- Financial retries: `Idempotency-Key: <16-128 safe characters>`
- Success: `{ "success": true, "message": "...", "data": ... }`
- Failure: `{ "success": false, "error": { "code": "...", "message": "..." }, "requestId": "..." }`
- Interactive Swagger: `GET /api/docs`
- OpenAPI JSON: `GET /api/docs.json`
- Process health: `GET /health`

## Complete Endpoint Catalog

Every route below is also registered in `docs/endpoint-registry.ts` and rendered into Swagger. `Auth` means a short-lived access token is required. Financial write routes additionally require an idempotency key.

### Authentication

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| POST | `/auth/register` | No | Create pending account, wallet, and email OTP |
| POST | `/auth/verify-email` | No | Verify OTP and create access/refresh session |
| POST | `/auth/resend-verification` | No | Replace email verification OTP |
| POST | `/auth/login` | No | Sign in verified active user |
| POST | `/auth/refresh` | No | Rotate refresh token with reuse detection |
| POST | `/auth/logout` | Yes | Revoke supplied refresh token |
| POST | `/auth/forgot-password` | No | Request non-enumerating password reset OTP |
| POST | `/auth/reset-password` | No | Reset password and revoke all sessions |

### Users and Devices

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| GET | `/users/me` | Yes | Get my profile |
| PATCH | `/users/me` | Yes | Update allowlisted profile fields |
| PATCH | `/users/me/password` | Yes | Change password and revoke sessions |
| POST | `/users/me/push-tokens` | Yes | Register Expo device token |
| DELETE | `/users/me/push-tokens` | Yes | Remove Expo device token |
| DELETE | `/users/me` | Yes | Confirm password and anonymize account |

### Events and Tickets

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| GET | `/events` | Optional | Search/filter events; nearest first when location is supplied or saved |
| GET | `/events/recommended` | Yes | Personalized nearby ranking from interests and ticket history |
| GET | `/events/created/me` | Yes | List my created events |
| GET | `/events/{id}` | Conditional | Get event and active ticket types; draft is owner-only |
| POST | `/events` | Yes | Create event draft |
| PATCH | `/events/{id}` | Yes | Update owned draft |
| POST | `/events/{id}/orders` | Yes + key | Reserve inventory and initialize paid/free ticket checkout |
| POST | `/events/{id}/publish` | Yes | Validate and publish owned event |
| POST | `/events/{id}/cancel` | Yes | Cancel owned event |
| DELETE | `/events/{id}` | Yes | Delete owned draft |
| POST | `/events/{id}/ticket-types` | Yes | Add ticket type (maximum 10) |
| PATCH | `/events/{id}/ticket-types/{ticketTypeId}` | Yes | Update unsold ticket type |
| DELETE | `/events/{id}/ticket-types/{ticketTypeId}` | Yes | Deactivate unsold ticket type |
| GET | `/events/{id}/attendees` | Yes | Owner attendee management list |
| POST | `/events/{id}/check-ins` | Yes | Owner QR validation and one-time check-in |
| GET | `/tickets` | Yes | List my ticket orders |
| GET | `/tickets/{orderNumber}` | Yes | Get owned paid ticket and QR token |
| GET | `/tickets/{orderNumber}/verify` | Yes | Verify exact Paystack payment and issue ticket |

### Communities and Friends

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| GET | `/communities` | No | Search/filter public communities |
| GET | `/communities/{id}` | No | Get community details |
| POST | `/communities` | Yes | Create and join owned community |
| PATCH | `/communities/{id}` | Yes | Update owned community |
| POST | `/communities/{id}/members` | Yes | Join public community |
| DELETE | `/communities/{id}/members/me` | Yes | Leave community (not owner) |
| GET | `/communities/{id}/members` | Yes | List safe member profiles |
| GET | `/friends` | Yes | List accepted friendships |
| GET | `/friends/requests` | Yes | List inbound pending requests |
| GET | `/friends/suggestions` | Yes | List users outside current graph |
| POST | `/friends/requests/{userId}` | Yes | Send unique request |
| PATCH | `/friends/requests/{id}` | Yes | Accept or decline inbound request |
| DELETE | `/friends/{id}` | Yes | Remove participating friendship |

### Chat and AI

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| GET | `/chat/conversations` | Yes | List participating conversations |
| POST | `/chat/conversations` | Yes | Create direct/group/support conversation |
| GET | `/chat/conversations/{id}/messages` | Yes | Cursor-paginated participant messages |
| POST | `/chat/conversations/{id}/messages` | Yes | Send idempotent client message and emit socket event |
| POST | `/chat/conversations/{id}/read` | Yes | Record and emit read receipt |
| POST | `/ai/chat` | Yes | Community Connect AI assistant |
| POST | `/ai/event-copy` | Yes | Generate grounded event copy |
| POST | `/ai/event-recommendations` | Yes | Run the local recommendation model with optional preferences/location |
| POST | `/ai/conversations/{id}/summary` | Yes | Summarize participant-owned conversation |
| GET | `/ai/sessions` | Yes | List my AI conversation states |
| DELETE | `/ai/sessions/{id}` | Yes | Delete my AI session |

### Notifications and Disputes

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| GET | `/notifications` | Yes | Filter notifications and unread count |
| PATCH | `/notifications/read-all` | Yes | Mark all owned notifications read |
| PATCH | `/notifications/{id}/read` | Yes | Mark one owned notification read |
| POST | `/disputes` | Yes | Open dispute with owned transaction check |
| GET | `/disputes` | Yes | List owned disputes; admins list all |
| GET | `/disputes/{id}` | Yes | Owner/admin dispute details |
| POST | `/disputes/{id}/messages` | Yes | Reply to open owner/admin dispute |
| PATCH | `/disputes/{id}/status` | Admin | Change status and resolution |

### Wallet and Paystack

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| GET | `/wallet` | Yes | Get wallet balances in kobo |
| GET | `/wallet/transactions` | Yes | Filter owned ledger entries |
| GET | `/wallet/transactions/{id}` | Yes | Get one owned transaction |
| POST | `/wallet/topups` | Yes + key | Create ledger entry and initialize Paystack |
| GET | `/wallet/topups/{reference}/verify` | Yes | Verify amount/status and credit once |
| GET | `/wallet/banks` | Yes | Cached active Paystack bank list |
| GET | `/wallet/bank-accounts` | Yes | List masked owned accounts |
| POST | `/wallet/bank-accounts` | Yes | Resolve, create recipient, encrypt and save account |
| DELETE | `/wallet/bank-accounts/{id}` | Yes | Deactivate owned account |
| POST | `/wallet/transfers` | Yes + key | Atomic internal debit/credit transfer |
| POST | `/wallet/withdrawals` | Yes + key | Reserve funds and initiate referenced payout |
| POST | `/wallet/withdrawals/{reference}/finalize` | Yes | Submit Paystack transfer OTP when required |

### Uploads and Webhooks

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| POST | `/uploads/images` | Yes | Validate and upload one image to Cloudinary |
| POST | `/webhooks/paystack` | HMAC | Verify, deduplicate, and process Paystack event |

## Realtime Socket.IO

Connect to the `/chat` namespace with the access JWT in `handshake.auth.token` (preferred) or `Authorization: Bearer ...`. Native clients without an Origin header are supported; browser origins must match `FRONTEND_URLS`.

| Event | Direction | Security/behavior |
|---|---|---|
| `socket:ready` | Server -> client | Confirms authenticated user room |
| `join-chat` / `conversation:join` | Client -> server | Database participant check before room join |
| `leave-chat` / `conversation:leave` | Client -> server | Leaves a conversation room |
| `message:new` | Server -> room | Emitted after REST message persistence |
| `conversation:read` | Server -> room | Emitted after REST read persistence |
| `typing:start` / `typing:stop` | Bidirectional | Ephemeral typing state; messages still use REST |

## Paystack Production Checklist

1. Configure `POST https://your-api.example.com/api/v1/webhooks/paystack` in Paystack.
2. Keep the Paystack secret only on the backend. The public key may be returned to the app for checkout.
3. Leave raw-body capture enabled. The webhook compares `x-paystack-signature` with HMAC-SHA512 in constant time.
4. Top-ups are credited only after signed `charge.success` or an authenticated server-to-server verification with exact amount matching.
5. Withdrawals use stored Paystack recipient codes, unique references, reserved wallet funds, and final `transfer.success`, `transfer.failed`, or `transfer.reversed` webhooks.
6. If Paystack transfer confirmation is enabled, call the finalize route with the user's OTP. Never log the OTP.

## Event Recommendation Algorithm

- Save a user location with `PATCH /users/me` using GeoJSON coordinates in `[longitude, latitude]` order.
- `GET /events` sorts by MongoDB geospatial distance whenever coordinates are provided or the authenticated user has a saved location.
- `GET /events/recommended` combines distance, profile interests, paid ticket history, local area, popularity, and start-date freshness.
- Distance has the highest weight, so personalization cannot bury genuinely nearby events. The response includes score, distance, and human-readable reasons.
- This ranking runs locally in TypeScript/MongoDB and does not call Groq.

## Security Notes

- Access tokens are short-lived. Refresh JWTs are hashed in MongoDB, rotated on every use, and tracked by family for replay response.
- Password/credential changes increment `tokenVersion` so previously issued access tokens stop working.
- Bank account numbers are encrypted with AES-256-GCM and are never returned; a per-user fingerprint prevents duplicates.
- Request bodies, query objects, and params reject Mongo operator/dotted keys before controllers run.
- Route Zod schemas are strict for security-sensitive payloads.
- Pino redacts authentication, passwords, OTPs, tokens, account numbers, and webhook bodies.
- Redis-backed global/auth/AI limits are shared across server instances. Financial operations additionally use a distributed lock.
- The public webhook route is protected by signature verification and persistent deduplication, not bearer auth.
- Do not copy secrets from any reference project. Only `.env.example` belongs in Git.

## External Provider Notes

- Groq powers generative AI through `openai/gpt-oss-20b` by default. Short AI session context is encrypted at rest; nearby-event ranking remains local and does not spend model tokens.
- Expo sends in batches of at most 100, accepts optional enhanced-security access tokens, and records ticket IDs. A production worker should fetch push receipts about 15 minutes later and remove `DeviceNotRegistered` tokens.
- ZeptoMail payloads are sent server-to-server using the configured send-mail token.
- Cloudinary receives only authenticated, MIME-checked, size-limited in-memory image uploads.


## Development Runtime

`yarn dev` runs **nodemon**, configured by `nodemon.json`. Nodemon watches the TypeScript application folders and executes `tsx app.ts` after changes. Vite and Vitest are not part of this backend. Tests use Node.js's built-in `node:test` runner through `tsx`.

The application follows the owner's single-entry style: `app.ts` composes Express, connects MongoDB and Redis, starts `app.listen`, attaches Socket.IO, starts cron jobs, and handles graceful shutdown. Socket connection events remain in `Socket/routes/Chat.Socket.ts`.

## Moving This Backend

The `backend` folder is self-contained and can be moved out of the Expo repository.

1. Stop the development server.
2. Move or copy the complete `backend` folder to its new location.
3. Do not carry over `node_modules`, `dist`, logs, or a real `.env` file.
4. In the new folder, run `copy .env.example .env` on Windows or `cp .env.example .env` on macOS/Linux.
5. Supply fresh secrets and provider credentials in `.env`.
6. Run `yarn install` and then `yarn dev`.
7. Point the Expo app's API and Socket.IO base URLs at the new backend host. Socket clients must connect to the `/chat` namespace.

Production deployment should run `yarn build` followed by `yarn start`, with MongoDB and Redis available before startup.

## Project Layout

See [`AGENTS.md`](./AGENTS.md) for the durable architecture and security rules. The important flow is:

```text
app.ts -> router/<domain> -> middleware -> functional controller -> models/<domain>
                                      \-> Community_AI or utils/<provider behavior>
```
