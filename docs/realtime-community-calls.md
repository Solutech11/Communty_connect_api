# Realtime Community and Calls Guide

Swagger documents HTTP endpoints only. This guide documents the Socket.IO events
and the LiveKit call hand-off used by the mobile client.

## Socket.IO

Connect to the `/chat` namespace. Send the access token through
`handshake.auth.token` (preferred) or as an `Authorization: Bearer <token>`
header. The server authenticates the socket before registering events.

```ts
import { io } from "socket.io-client";

const socket = io(`${API_BASE_URL}/chat`, {
  auth: { token: accessToken },
  transports: ["websocket"],
});
```

Use Socket.IO, not a plain WebSocket client.

### Community room events

| Direction | Event | Payload / acknowledgement |
|---|---|---|
| Client → server | `community:join` | `{ communityId }`; server checks active membership before joining `community:<communityId>`. Ack: `{ success, communityId?, code?, message }`. |
| Client → server | `community:leave` | `{ communityId }`. Ack has the same structured shape. |
| Client → server | `community:typing` | `{ communityId, typing }`; only emitted to other sockets already in that room. |
| Server → client | `community:typing` | `{ communityId, userId, firstName, typing }`. |
| Server → client | `community:message:new` | A persisted CommunityMessage. |
| Server → client | `community:message:updated` | A persisted CommunityMessage after edit, reaction, or pin change. |
| Server → client | `community:message:deleted` | `{ communityId, messageId }`. |
| Server → client | `community:post:new` | A persisted CommunityPost. |
| Server → client | `community:announcement:new` | A persisted CommunityAnnouncement. |
| Server → client | `community:member:updated` | A CommunityMember after approval, role/status change, ban, removal, direct join, or ownership transfer. |
| Server → client | `community:call:started` | CommunityCall. |
| Server → client | `community:call:updated` | CommunityCall, for example after a participant first joins. |
| Server → client | `community:call:ended` | CommunityCall with `status: "ended"`. |

Persist messages, reads, reactions, and call actions through REST first. Socket
events notify other connected clients after persistence succeeds.

## LiveKit voice/video calls

1. Create a LiveKit project or self-host a LiveKit server.
2. Configure the backend only:

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
CALL_TOKEN_TTL_SECONDS=600
```

3. An owner/moderator calls `POST /communities/:id/calls`.
4. An active member calls `POST /communities/:id/calls/:callId/join`.
5. The backend returns `provider`, `roomName`, `participantToken`, and
   `expiresAt`. The mobile app uses those values to connect to LiveKit.

Never place `LIVEKIT_API_SECRET` in Expo or generate tokens on the device.
When LiveKit environment variables are empty, the join endpoint returns
`COMMUNITY_CALL_PROVIDER_UNAVAILABLE` rather than producing unsafe credentials.

## External references

- Socket.IO: <https://socket.io/docs/v4/>
- Socket.IO client API: <https://socket.io/docs/v4/client-api/>
- LiveKit overview: <https://docs.livekit.io/intro/overview/>
- LiveKit React Native / Expo SDK guidance: <https://docs.livekit.io/transport/sdk-platforms/react-native/>
- LiveKit access tokens and grants: <https://docs.livekit.io/frontends/reference/tokens-grants/>
