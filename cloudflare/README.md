# Vumiro coordination service

Client 1.15 adds online profile/username lookup, signed friend requests/acceptance, blocking, event-driven mutual-friend room announcements and request/approval flows. Exact contracts and limits are in [PROTOCOL.md](../docs/plans/vumiro-social/PROTOCOL.md). Guest room entry now requires an owner-signed identity-bound grant as well as current mutual friendship. Chat and profile pictures use direct peer data channels and are never uploaded to this Worker. Profiles remain local; directory metadata and pending requests exist only while sockets are connected.

The root page opens the friends client. Presence and direct invitations require mutual friend subscriptions; one-sided adds do not disclose online status. `/friends-signaling` uses a separate `FRIEND_DIRECTORY` Durable Object for authenticated live presence and signed call invitations. It persists no profile/friend database: identity proofs and presence watches exist only in WebSocket attachments. `/call` and `/call-signaling` retain shared rooms. Only the five client assets are published. Private keys and authoritative contact records remain on devices. The directory currently supports 256 live connections and 128 watched contacts per connection; larger deployments need partitioning.

This Worker serves the room page and a signaling-only WebSocket endpoint. One SQLite-backed Durable Object coordinates each room, with WebSocket hibernation and attachment-backed membership. Screen and voice use direct browser WebRTC connections. The service contains no TURN relay, recording, or screen upload endpoint.

## Run locally

From this directory, run `npm install`, then `npm run dev`. Open the printed localhost URL in Chrome or Edge, exchange contact codes, then create a room and share its invitation. The legacy local server uses the earlier anonymous protocol; use this Worker with client 1.14 private rooms.

The earlier room test harness targets the anonymous protocol and needs updating for client 1.14. Runtime tests for this iteration are deferred to the user; no end-to-end security verification is claimed.

## Make it available to friends

Deployed on 2026-11-01 to **https://screentask-rooms.screentask-room-signaling.workers.dev**. ScreenTask defaults to `wss://screentask-rooms.screentask-room-signaling.workers.dev/call-signaling`. The invitation opens the hosted room page, so friends join and share without installing or starting their own ScreenTask server. HTTPS and a user gesture are required for browser screen capture; localhost is allowed for development.

To update the service, sign in with `npx wrangler login`, set `CLOUDFLARE_ACCOUNT_ID` for the intended account, then run `npm run deploy`. A custom domain is optional. Hosting and usage are subject to the account's plan and limits. OAuth credentials remain in Wrangler's local credential storage and are not included in this repository or the Windows package.

Room codes bind the owner's public identity to 24 cryptographically random bytes. A link alone grants no access: members prove their local identity, and guests must be mutual friends of the connected owner. Maximum 8 participants. Signed friend-policy revisions revoke removed contacts and reject stale updates. Owner departure closes guest sessions. The Worker overwrites sender identities, routes messages only within the room, permits only SDP offer/answer and ICE candidate messages, rejects TURN relay candidates, and caps messages at 64 KiB and 240 per 10 seconds per connection. It does not persist room contents. Deployments or network interruptions can require clients to rejoin; the client reconnects automatically while retaining the current local screen capture.

Mesh bandwidth grows with the number of viewers. A 20 Mbps setting is an upper bound **per remote participant**, not a shared room budget. The browser may lower FPS when bandwidth or CPU is insufficient; the client shows actual decoded FPS and connection RTT. Restrictive NATs/firewalls may prevent direct media even when signaling works. STUN discovers possible direct paths; it cannot guarantee connectivity.

Official references: [Durable Object WebSockets and hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Workers static assets](https://developers.cloudflare.com/workers/static-assets/), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/).
