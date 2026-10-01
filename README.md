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
- Secured EJS operations portal at `/admin`

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
3. Provider credentials and configured dashboard settings for Paystack, Cloudinary, ZeptoMail, Groq, Geoapify (for location search), and Expo enhanced push security if enabled.

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
- Every Swagger operation includes concrete body/query/header schemas, request examples, success examples, and reusable error examples.
- Process health: `GET /health`

## Seed an Admin Account

Use environment variables so the password is never committed to source control:

```powershell
$env:ADMIN_EMAIL = "admin@admin.com"
$env:ADMIN_PASSWORD = "choose-a-strong-password"
yarn seed:admin
Remove-Item Env:ADMIN_PASSWORD
```

The script creates or updates the account as an active, verified admin, revokes existing refresh sessions when updating it, and creates a wallet when one is missing.

## Complete Endpoint Catalog

Every route below is also registered in `docs/endpoint-registry.ts` and rendered into Swagger. `Auth` means a short-lived access token is required. Financial write routes additionally require an idempotency key.

### Authentication

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| POST | `/auth/register` | No | Create pending account, wallet, email OTP, and optionally save a GeoJSON user location |
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
| GET | `/users/me` | Yes | Get my profile, personalization fields, and connection/event totals |
| PATCH | `/users/me` | Yes | Update allowlisted profile and personalization fields |
| PATCH | `/users/me/avatar` | Yes | Upload and save one profile photo |
| PATCH | `/users/me/password` | Yes | Change password and revoke sessions |
| POST | `/users/me/push-tokens` | Yes | Register Expo device token |
| DELETE | `/users/me/push-tokens` | Yes | Remove Expo device token |
| DELETE | `/users/me` | Yes | Confirm password and anonymize account |
| POST | `/users/{id}/reports` | Yes | Report an active user account for moderation |

Personalization fields on a user are `preferredSetting` (`indoor` or `outdoor`),
`preferredGroupSize` (`small`, `medium`, or `large`), `participationRole`
(`participant` or `organizer`), and `hobbies` (up to 20 strings). The
participation role is a preference only and never grants organizer, moderator,
or admin permissions. `PATCH /users/me` accepts these fields together with
`phone`, `interests`, and the other documented allowlisted profile fields. GET /users/me also returns totals.connections (accepted friendships) and totals.events (all events created by the signed-in user, across statuses).

### Locations

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| GET | `/locations/search` | Yes | Search Geoapify address suggestions (required `q`; optional `countryCode`, paired `latitude`/`longitude`, and limit capped at 8) |
| GET | `/locations/reverse` | No | Rate-limited Geoapify state lookup from required `latitude` and `longitude` |

Set `GEOAPIFY_API_KEY` in the backend environment. The key is never returned to the mobile app.

### Events and Tickets

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| GET | `/events` | Optional | Search/filter events; nearest first when location is supplied or saved |
| GET | `/events/discover` | No | Browse trending, recently published, and past events with state filtering |
| GET | `/events/recommended` | Yes | Personalized upcoming ranking, including events with your paid tickets |
| GET | `/events/created/me` | Yes | List my created events |
| GET | `/events/{id}` | Conditional | Get event and active ticket types; draft is owner-only |
| POST | `/events` | Yes | Create event draft |
| PATCH | `/events/{id}` | Yes | Update owned draft or declined event (editing a decline returns it to draft) |
| POST | `/events/{id}/orders` | Yes + key | Reserve inventory and initialize paid/free ticket checkout |
| POST | `/events/{id}/publish` | Yes | Immediately review content, pricing, and cover image with Groq; publish safe events or notify the organizer with rejection reasons |
| POST | `/events/{id}/cancel` | Yes | Cancel owned event |
| DELETE | `/events/{id}` | Yes | Delete owned draft or declined event |
| POST | `/events/{id}/ticket-types` | Yes | Add ticket type (maximum 10) to a draft or declined event |
| PATCH | `/events/{id}/ticket-types/{ticketTypeId}` | Yes | Update unsold ticket type on a draft or declined event |
| DELETE | `/events/{id}/ticket-types/{ticketTypeId}` | Yes | Deactivate unsold ticket type on a draft or declined event |
| GET | `/events/{id}/attendees` | Yes | Owner attendee list with check-in flags, timestamps, and count summary |
| POST | `/events/{eventId}/check-ins/verify` | Yes | Read-only QR preview with attendee and ticket details, check-in eligibility, and prior check-in time |
| POST | `/events/{id}/check-ins` | Yes | Owner QR validation and one-time check-in, available from two hours before the event through its end time; notifies the attendee by email and in-app notification |
| POST | `/events/{id}/reports` | Yes | Report a published event for moderation |
| GET | `/tickets` | Yes | List my ticket orders |
| GET | `/tickets/{orderNumber}` | Yes | Get owned paid ticket and QR token |
| POST | `/tickets/{orderNumber}/checkout` | Yes + key | Resume payment on an existing pending order; returns `checkout_ready` with a verified Paystack URL or `already_paid`; no request body |
| GET | `/tickets/{orderNumber}/verify` | Yes | Verify Paystack settlement amount and issue ticket |

`GET /events/{id}` returns active ticket tiers at `data.ticketTypes`. Each tier exposes its MongoDB `_id`, title, optional description and capacity, `priceKobo`, sold count, active flag, and timestamps. Ticket purchase prices use integer kobo in the API; the mobile UI converts them to naira for display. `/tickets` returns `data.tickets` with full order fields plus populated event and ticket-type summaries.

`POST /tickets/{orderNumber}/checkout` takes no body. Send a fresh `Idempotency-Key` for a new checkout action, and reuse that key when retrying the same action. It checks every recorded Paystack reference before returning `checkout_ready` with `checkoutUrl` or `already_paid` without a URL. Uncertain payments return `PAYMENT_STILL_PROCESSING`; expired, cancelled, refunded, unreserved, or eight-attempt orders return `TICKET_ORDER_NOT_RETRYABLE`.

### Communities and Friends

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| GET | `/communities` | No | Search/filter public communities |
| POST | `/communities/resolve-code` | Yes | Resolve a private access code to a community ID and safe preview |
| GET | `/communities/{id}` | No | Get public details; private details require active membership |
| POST | `/communities` | Yes | Atomically create a community and owner membership with optional `joinPolicy` and access code |
| PATCH | `/communities/{id}` | Yes | Update owned community |
| POST | `/communities/{id}/members` | Yes | Join a free public community |
| POST | `/communities/{id}/membership-orders` | Yes + key | Initialize premium checkout; legacy restricted premium communities require approved access |
| GET | `/communities/membership-orders/{orderNumber}/verify` | Yes | Verify Paystack settlement and activate premium membership |
| DELETE | `/communities/{id}/members/me` | Yes | Leave community (not owner) |
| GET | `/communities/{id}/members` | Yes | List membership records with nested safe user profiles and pagination |
| GET | `/communities/{id}/posts` | Yes | List paginated room posts with author profiles |
| POST | `/communities/{id}/posts` | Yes | Publish a member room post |
| GET | `/communities/{id}/announcements` | Yes | List paginated room announcements |
| POST | `/communities/{id}/announcements` | Owner/mod | Publish a room announcement |
| GET | `/communities/{id}/messages` | Yes | List cursor paginated room messages with `pageInfo` |
| POST | `/communities/{id}/messages` | Yes | Send idempotent room message |
| POST | `/communities/{id}/reports` | Yes | Report an accessible community for moderation |
| GET | `/users/me/communities` | Yes | List my memberships with unread counts and notification level |
| GET | `/users/me/community-join-requests` | Yes | Restore my pending community join requests |
| GET | `/communities/{id}/rules` | Public/member | Get public or accessible community rules |
| PUT | `/communities/{id}/rules` | Owner/mod | Replace ordered community rules and consequences |
| GET | `/communities/{id}/settings` | Member | Get messaging and join settings |
| PATCH | `/communities/{id}/settings` | Owner/mod | Update settings and securely rotate an access code |
| PATCH | `/communities/{id}/members/{userId}` | Owner/mod | Change eligible role or membership status |
| DELETE | `/communities/{id}/members/{userId}` | Owner/mod | Remove an eligible community member |
| PUT | `/communities/{id}/bans/{userId}` | Owner/mod | Ban a member with reason and optional expiry |
| DELETE | `/communities/{id}/bans/{userId}` | Owner/mod | Unban a removed member |
| POST | `/communities/{id}/join-requests` | Yes | Join free communities or validate access and request approval; premium access requires checkout |
| POST | `/communities/{id}/invites` | Owner/mod | Create hashed, expiring, use-limited invite token |
| GET | `/communities/{id}/join-requests` | Owner/mod | Review queued membership requests |
| PATCH | `/communities/{id}/join-requests/{requestId}` | Owner/mod | Approve or reject a join request |
| DELETE | `/communities/{id}/join-requests/me` | Requester | Cancel my pending join request |
| POST | `/communities/{id}/ownership-transfer` | Owner | Transfer ownership to an active member |
| PATCH | `/communities/{id}/posts/{postId}` | Author/mod | Edit a community post |
| DELETE | `/communities/{id}/posts/{postId}` | Author/mod | Delete a community post |
| PATCH | `/communities/{id}/announcements/{announcementId}` | Owner/mod | Edit or pin announcement |
| DELETE | `/communities/{id}/announcements/{announcementId}` | Owner/mod | Delete announcement |
| PUT | `/communities/{id}/messages/read` | Member | Save last read message and clear unread badge |
| PATCH | `/communities/{id}/notification-preferences/me` | Member | Mute/unmute or set notification level |
| PATCH | `/communities/{id}/messages/{messageId}` | Author/mod | Edit message |
| DELETE | `/communities/{id}/messages/{messageId}` | Author/mod | Delete message |
| PUT | `/communities/{id}/messages/{messageId}/reactions/{emoji}` | Member | Add reaction |
| DELETE | `/communities/{id}/messages/{messageId}/reactions/{emoji}` | Member | Remove reaction |
| PUT | `/communities/{id}/messages/{messageId}/pin` | Owner/mod | Pin message |
| DELETE | `/communities/{id}/messages/{messageId}/pin` | Owner/mod | Unpin message |
| POST | `/communities/{id}/messages/{messageId}/reports` | Member | Report harmful message |
| POST | `/communities/{id}/calls` | Owner/mod | Start voice or video call |
| GET | `/communities/{id}/calls/active` | Member | Get active call |
| POST | `/communities/{id}/calls/{callId}/join` | Member | Get short-lived server-issued call credential |
| DELETE | `/communities/{id}/calls/{callId}` | Starter/mod | End active call |

Private code lookup uses a keyed index created when an access code is set. Owners of pre-existing private communities must rotate their access code once through `PATCH /communities/{id}/settings` to enable code-only lookup. Creating a private community with `joinPolicy` and `accessCode` in one request creates the community and owner membership in a MongoDB transaction.
| GET | `/friends` | Yes | List accepted friendships with safe requester/addressee profiles |
| GET | `/friends/requests` | Yes | List inbound requests with safe requester/addressee profiles |
| GET | `/friends/suggestions` | Yes | List users outside current graph |
| POST | `/friends/requests/{userId}` | Yes | Send unique request |
| PATCH | `/friends/requests/{id}` | Yes | Accept or decline inbound request |
| DELETE | `/friends/{id}` | Yes | Remove participating friendship |

### Roommates and User Blocks

Roommate discovery is opt-in. Rent budgets are personal annual shares in kobo.
Mutual likes create connects; contacts require separate consent. Only a request's
recipient can accept a pairing, making both roommate profiles private. Either
person can end it; both profiles stay paused until explicitly resumed.
See [matching, consent, deployment and integration tests](docs/roommate-matching.md).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/roommates/questions` | Yes | Questionnaire options and version |
| GET | `/roommates/profiles/me` | Yes | My roommate profile or null |
| PUT | `/roommates/profiles/me` | Yes | Replace my questionnaire answers |
| PATCH | `/roommates/profiles/me/visibility` | Yes | Activate, pause or resume discovery |
| GET | `/roommates/candidates` | Yes | Ranked, paginated compatible profiles |
| PUT | `/roommates/decisions/{userId}` | Yes | Idempotent like or pass |
| GET | `/roommates/connections` | Yes | Paginated mutual connects |
| GET | `/roommates/connections/{id}` | Yes | Authorized connect detail |
| DELETE | `/roommates/connections/{id}` | Yes | Ignore or end a connect |
| PUT | `/roommates/connections/{id}/contact-consents/me` | Yes | Choose phone and/or email to share |
| DELETE | `/roommates/connections/{id}/contact-consents/me` | Yes | Revoke my consent |
| GET | `/roommates/connections/{id}/contacts` | Yes | Read contacts after both consent |
| POST | `/roommates/connections/{id}/requests` | Yes | Request roommate pairing |
| PATCH | `/roommates/connections/{id}/requests/{requestId}` | Yes | Accept, decline or cancel request |
| DELETE | `/roommates/connections/{id}/pairing` | Yes | End pairing and pause profiles |
| GET | `/users/me/blocks` | Yes | Paginated users I blocked |
| PUT | `/users/me/blocks/{userId}` | Yes | Block direct interaction |
| DELETE | `/users/me/blocks/{userId}` | Yes | Remove my block |

### Chat and AI

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| GET | `/chat/conversations` | Yes | List participant profiles, unread counts, and last-message previews |
| POST | `/chat/conversations` | Yes | Create direct/group/support conversation |
| GET | `/chat/conversations/{id}/messages` | Yes | Cursor-paginated participant messages |
| POST | `/chat/conversations/{id}/messages` | Yes | Send idempotent client message and emit socket event |
| POST | `/chat/conversations/{id}/read` | Yes | Record and emit read receipt |
| POST | `/ai/chat` | Yes | Community Connect AI assistant |
| POST | `/ai/guest-chat` | No | Rate-limited public AI chat; visitor text is sent to Groq |
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
| POST | `/wallet/topups` | Yes + key | Initialize requested wallet credit plus deposit charge |
| GET | `/wallet/topups/{reference}/verify` | Yes | Verify amount/status and credit once |
| GET | `/wallet/banks` | Yes | Cached active Paystack bank list |
| GET | `/wallet/bank-accounts` | Yes | List masked owned accounts |
| POST | `/wallet/bank-accounts` | Yes | Resolve, create recipient, encrypt and save account |
| DELETE | `/wallet/bank-accounts/{id}` | Yes | Deactivate owned account |
| POST | `/wallet/transfers` | Yes + key | Atomic internal debit/credit transfer |
| POST | `/wallet/withdrawals` | Yes + key | Reserve funds, deduct withdrawal charge, and initiate net payout |
| POST | `/wallet/withdrawals/{reference}/finalize` | Yes | Submit Paystack transfer OTP when required |

### Uploads and Webhooks

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| POST | `/uploads/images` | Yes | Validate and upload one image to Cloudinary |
| POST | `/uploads/files` | Yes | MIME-checked community image, PDF, or document attachment |
| POST | `/webhooks/paystack` | HMAC | Verify, deduplicate, and process Paystack event |

## Realtime Socket.IO

See [Realtime Community and Calls Guide](./docs/realtime-community-calls.md) for Socket.IO payloads, acknowledgements, LiveKit setup, and Expo integration.

Connect to the `/chat` namespace with the access JWT in `handshake.auth.token` (preferred) or `Authorization: Bearer ...`. Native clients without an Origin header are supported; browser origins must match `FRONTEND_URLS`.

| Event | Direction | Security/behavior |
|---|---|---|
| `socket:ready` | Server -> client | Confirms authenticated user room |
| `join-chat` / `conversation:join` | Client -> server | Database participant check before room join |
| `leave-chat` / `conversation:leave` | Client -> server | Leaves a conversation room |
| `message:new` | Server -> room | Emitted after REST message persistence |
| `conversation:read` | Server -> room | Emitted after REST read persistence |
| `typing:start` / `typing:stop` | Bidirectional | Ephemeral typing state; messages still use REST |
| `community:join` / `community:leave` | Client -> server | Verifies active membership before room join; returns structured acknowledgement |
| `community:typing` | Bidirectional | Emits active-member typing state inside the joined community room |
| `community:message:new` / `community:message:updated` / `community:message:deleted` | Server -> room | Realtime community chat persistence events |
| `community:post:new` / `community:announcement:new` / `community:member:updated` | Server -> room | Realtime community content and membership events |
| `community:call:started` / `community:call:updated` / `community:call:ended` | Server -> room | Community voice/video call lifecycle events |

## Admin Portal and Platform Charges

- Visit `/admin/login` and sign in with an active user whose role is `admin`. The `BOOTSTRAP_ADMIN_EMAIL` registration flow remains the only public bootstrap path.
- The portal is sectioned into moderation, members, administrator team, and revenue areas. Administrators with `admins:manage` can create active verified administrator accounts; their passwords are hashed before storage.
- Administrators with `users:moderate` can block active non-admin accounts. Blocking revokes refresh sessions immediately; unblocking restores the member account. Administrator accounts cannot be blocked through the portal.
- Admin browser sessions are hashed in MongoDB, expire automatically, bind to IP and user agent, use secure HttpOnly SameSite cookies, and require CSRF tokens for every action.
- `POST /events/{id}/publish` runs immediate Groq moderation over event details, ticket-price consistency, and the authenticated Cloudinary cover image. Safe events are published automatically. Declined events retain category-specific reasons, notify the organizer in-app and by email, and can be corrected and resubmitted. If the provider is unavailable, the event remains `pending_approval` for manual portal review. Published events can be deactivated with a recorded reason.
- Platform percentages are configured as integer basis points: `DEPOSIT_CHARGE_BPS`, `WITHDRAWAL_CHARGE_BPS`, `TICKET_CHARGE_BPS`, and `COMMUNITY_CHARGE_BPS`.
- Deposit fees are added to the desired wallet credit; withdrawal fees are deducted from the requested payout; ticket fees are added as a service fee; premium-community fees are retained from owner proceeds.
- Earnings are recognized only inside the same Mongo transaction that completes the verified payment or successful withdrawal. The immutable source reference prevents duplicate earnings.

## Paystack Production Checklist

1. Configure `POST https://your-api.example.com/api/v1/webhooks/paystack` in Paystack.
2. Keep the Paystack secret only on the backend. The public key may be returned to the app for checkout.
3. Leave raw-body capture enabled. The webhook compares `x-paystack-signature` with HMAC-SHA512 in constant time.
4. Top-ups are credited only after signed `charge.success` or an authenticated server-to-server verification. The Paystack amount must equal the initialized wallet credit plus platform deposit charge, or the charged amount less Paystack's reported processing fee must equal it when Paystack's "Pass fees to customers" setting is enabled.
   The same settlement rule applies to paid ticket and premium community orders before their inventory or memberships are finalized.
5. Confirmed wallet top-ups, ticket purchases, premium memberships, successful withdrawals, and internal wallet transfers send transaction emails to the affected users. Mail delivery is best-effort and does not reverse a committed financial transaction.
6. Withdrawals use stored Paystack recipient codes, unique references, reserved wallet funds, and final `transfer.success`, `transfer.failed`, or `transfer.reversed` webhooks.
7. If Paystack transfer confirmation is enabled, call the finalize route with the user's OTP. Never log the OTP.

## Event Recommendation Algorithm

- `POST /auth/register` and `PATCH /users/me` accept an optional GeoJSON `location` using coordinates in `[longitude, latitude]` order. Omit `location` entirely when it is unavailable; never send a partial point.
- `GET /events` sorts by MongoDB geospatial distance whenever coordinates are provided or the authenticated user has a saved location.
- `GET /events/recommended` combines distance, profile interests, paid ticket history, local area, popularity, and start-date freshness. It also includes and prioritizes your upcoming published ticketed events, marked with `hasTicket: true` and a `You have a ticket` reason.
- Distance has the highest weight, so personalization cannot bury genuinely nearby events. The response includes score, distance, and human-readable reasons.
- This ranking runs locally in TypeScript/MongoDB and does not call Groq.

## Event Moderation Testing

- Set `EVENT_AUTO_APPROVE_FOR_TESTING=true` in a development or test environment to skip Groq moderation and automatically approve events when they are submitted for publishing. Leave it unset or set it to `false` to use normal moderation.
- The API refuses to start in production when this override is enabled. Event date and ticket-type validation still applies.

## Security Notes

- Development accepts browser origins to support local and LAN testing. Production accepts only the explicit `FRONTEND_URLS` allowlist.

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

- Groq powers generative AI through `openai/gpt-oss-20b` by default and uses `qwen/qwen3.8-27b` for event moderation with cover-image vision. Event moderation receives only the event public listing data and ticket definitions; short AI session context is encrypted at rest; nearby-event ranking remains local and does not spend model tokens.
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

