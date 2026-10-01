# Roommate matching

Roommate discovery is optional and available to active users who declare they are
18 or older. This declaration does not certify age or identity. Existing accounts
start outside discovery; no data migration or automatic enrollment is required.

## State and consent

Profiles are draft, discoverable, paused, or paired. Save answers with
`PUT /api/v1/roommates/profiles/me`; this replaces the questionnaire answers.
Activation requires complete answers and a move-in window that has not expired.
Hosts choose exactly one LGA. Rent ranges describe each person's annual share in
integer kobo; a host specifies the requested roommate share. This feature does
not collect rent or create a tenancy agreement.

Like/pass decisions are immutable and repeated identical submissions are safe.
Reciprocal likes create one connect and one canonical direct conversation.
Both participants may chat, use existing friendship requests, and independently
choose contact fields. Both contact grants must be valid before either person
can retrieve the other's chosen fields. Contact responses use `Cache-Control:
no-store`. Changed contact values invalidate the affected grant. Revocation
cannot recall details already viewed or saved by another person.

A roommate request is accepted only by its recipient. Acceptance atomically
sets both profiles to paired/private, closes other active roommate connects and
pending requests, and records one confirmed pair. Either person can end the
pairing. Both profiles return to paused; each person must explicitly resume.
Ordinary friendships and chat history remain separate from roommate decisions.

Blocks apply in either direction to discovery, friendship requests, direct REST
chat, socket joins, and typing. Blocking ends the pair's roommate connection and
evicts sockets from its direct conversation rooms. Group membership is separate.
Socket events `roommates:changed` and `social:access-changed` carry empty payloads
and signal clients to clear transient contact data and reload authorized REST data.

Meaningful roommate events and friend requests/acceptances create an in-app
notification and Expo push, then email the account's verified address. These
include mutual matches, roommate requests and responses, contact-consent changes,
and ended connects. Individual likes/passes and a user's own profile edits stay
quiet. When ZeptoMail is unavailable outside production, the mailer records a
redacted envelope in the terminal; it never prints OTPs or email bodies. Production
requires the ZeptoMail token.

## Matching

Eligibility requires compatible housing modes, state/LGA, annual rent range,
move-in range, reciprocal gender choices, smoking and pets. Rank eligible profiles
using living habits (40%), interest/hobby overlap (30%), rent overlap (20%), and
move-in overlap (10%). Shared tags use case-normalized Jaccard similarity; ranges
use intersection over union. A compatible single-point range receives full range
agreement. Missing tags receive zero interest points. Ties use user ID order.
Scores are compatibility estimates and are not guarantees of a successful tenancy.

## Deployment and verification

Deploy the backend before releasing mobile entry points. Mongo must support
transactions (replica set) and Redis must be available. Do not disable transactions
or lock checks for standalone Mongo. Mongoose creates new unique/discovery indexes
under the repository's existing index policy; provision them before accepting
traffic if production auto-indexing is disabled by running `yarn indexes:roommates`.
Existing conversations acquire a
canonical direct-pair key on reuse; historical duplicates are retained.

Run `yarn typecheck`, `yarn test`, `yarn docs:check`, and `yarn build`.
The real-database lifecycle suite is opt-in:

```powershell
$env:RUN_ROOMMATE_INTEGRATION = 'true'
yarn test
```

It requires local MongoDB at port 27017 configured as a replica set and local
Redis at port 6379. It creates and drops only `community_connect_roommate_test`,
uses Redis DB 15, and sends no external messages or notifications when fixture
users have no push tokens. Never run two copies of this integration suite at once.

Apartment discovery is deferred. A later provider integration should display
attributed listings and external links, with explicit rent period and freshness.
Shortlet's partner guide covers short stays and requires approved partner access:
https://shortlet.app/documentation . Production access and suitable Nigerian
inventory must be confirmed before implementation; no provider credentials belong
in mobile code.
