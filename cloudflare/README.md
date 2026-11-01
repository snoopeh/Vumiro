# Vumiro signaling

The coordination service is **https://vumiro-rooms.vumiro-signaling.workers.dev**. Use client 1.21.1 or newer for this address. Updated clients migrate known legacy service URLs and invitations automatically while preserving custom connection services and local profiles.

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

The public Worker is `vumiro-rooms`. Its Durable Object bindings reference the existing `screentask-rooms` storage owner directly, retaining the same namespace IDs and stored friend requests. That legacy resource name is an internal compatibility identifier, not a public service URL. Do not recreate its namespaces. Original migration history lives in `wrangler.storage.jsonc`; the storage owner has no public workers.dev route. `npm run deploy` updates both scripts, with no proxy hop or extra service polling.

The account's workers.dev subdomain is `vumiro-signaling`. Renaming that account subdomain retires the old `screentask-room-signaling` URLs. Older installed clients can still download their GitHub update; both peers should update before using the new address.

Runtime tests are deferred to the user for this iteration. Compilation, JavaScript syntax and deployment checks do not claim an end-to-end/security audit. Service usage remains subject to the account's Cloudflare limits.
