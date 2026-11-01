# Vumiro signaling

The deployed coordination service is **https://screentask-rooms.screentask-room-signaling.workers.dev**. The existing hostname, Worker name and Durable Object bindings remain stable so installed clients keep connecting.

`/friends-signaling` proves device identities, announces online display names/usernames, handles mutual-friend presence, requests and room snapshots, and routes bounded signed profile-only SDP/ICE exchanges. Pictures themselves travel directly between peers. `/call-signaling` authenticates participants and enforces the owner's room access mode: public, mutual friends, or password. Legacy clients retain the older grant-based friendship policy.

The Worker stores no persistent account/contact database and relays no media, chat, pictures or arbitrary file payloads. WebSocket attachments hold bounded live coordination state. Version 2 friend requests use indexed SQLite rows for public identities and signed proofs: pending requests last up to 24 hours, terminal outcomes at most seven days or until both apps acknowledge them. Reconnect replay and receipts use the existing WebSocket; there is no polling. One-shot alarms clean up actual expirations. Rooms use direct mesh WebRTC, at most eight participants, and require the owner to remain connected. STUN assists route discovery; there is no TURN relay.

The six client assets are prepared from `Vumiro.Client/WebServer`; no device data or retired server pages are published. Exact signed messages, limits and compatibility behavior are documented in [the protocol](../docs/PROTOCOL.md).

## Develop and deploy

From this directory:

```powershell
npm ci
npm run dev
```

For deployment, authenticate with `npx wrangler login`, set `CLOUDFLARE_ACCOUNT_ID` for the intended account and run `npm run deploy`. OAuth credentials remain in Wrangler's local credential storage, outside the repository/package. `npm run prepare-assets` copies only the six allowlisted web files.

Do not rename the deployed Worker or recreate its Durable Object bindings during cosmetic cleanup: that creates a separate coordination service. The original migration history remains in `wrangler.jsonc`.

Runtime tests are deferred to the user for this iteration. Compilation, JavaScript syntax and deployment checks do not claim an end-to-end/security audit. Service usage remains subject to the account's Cloudflare limits.
