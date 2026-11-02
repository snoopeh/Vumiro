# Vumiro signaling

The coordination service is **https://vumiro-rooms.vumiro-signaling.workers.dev**. Use client 1.21.1 or newer for this address. Updated clients migrate known legacy service URLs and invitations automatically while preserving custom connection services and local profiles.

`/friends-signaling` proves device identities, announces online display names/usernames, handles mutual-friend presence, requests and room snapshots, and routes bounded signed profile-only SDP/ICE exchanges. Pictures themselves travel directly between peers. `/call-signaling` authenticates participants and enforces the owner's room access mode: public, mutual friends, or password. Legacy clients retain the older grant-based friendship policy.

The Worker keeps account sync in a separate D1 database, distinct from Durable Object signaling state. Account auth is delegated to Supabase Auth; the Worker verifies ES256 or RS256 access-token signatures, checks recent reauthentication from AMR timestamps, and requires a per-device secret whose hash is stored with linked-device revocation records. The app pins account traffic to this canonical Worker even when a user configures a custom signaling service. The identity-recovery envelope is encrypted in the client; other snapshot fields are readable to authorized service operators. The account database is currently in Cloudflare D1 region `ENAM` (Eastern North America); account registration must remain disabled until provider regions, transfers, retention, privacy contact, and the notice are finalized. See [the account and privacy setup](../docs/PRIVACY.md).

The Worker does not relay media, chat, profile pictures, or arbitrary file payloads. WebSocket attachments hold bounded live coordination state. Version 2 friend requests use indexed SQLite rows for public identities and signed proofs: pending requests last up to 24 hours, terminal outcomes at most seven days or until both apps acknowledge them. Reconnect replay and receipts use the existing WebSocket; there is no polling. One-shot alarms clean up actual expirations. Rooms use direct mesh WebRTC, at most eight participants, and require the owner to remain connected. STUN assists route discovery; there is no TURN relay.

The allowlisted client assets are prepared from `Vumiro.Client/WebServer`; no device data or retired server pages are published. Exact signed messages, limits and compatibility behavior are documented in [the protocol](../docs/PROTOCOL.md).

## Develop and deploy

From this directory:

```powershell
npm ci
npm run dev
```

For deployment, authenticate with `npx wrangler login`, set `CLOUDFLARE_ACCOUNT_ID` for the intended account and run `npm run deploy`. OAuth credentials remain in Wrangler's local credential storage, outside the repository/package. `npm run prepare-assets` copies only the allowlisted web files.

## Account auth configuration

The dedicated `vumiro-account-data` D1 database and migrations are provisioned separately from the existing Durable Object namespaces. Before account routes can serve users:

1. Create/configure the Supabase project. Enable email/password sign-up, require email confirmation, use asymmetric JWT signing (ES256 or RS256), set the minimum password length to at least 12 characters, enable compromised-password protection when available, and configure confirmation/recovery email templates to include the six-digit `{{ .Token }}` code. Set and document Supabase's processing region and auth-email retention.
2. Keep the publishable key (or legacy anon key), project URL, and service-role key ready. The service-role key is used only for account deletion and must never go into the client or source control.
3. Set Worker runtime values with `npx wrangler secret put SUPABASE_URL`, `npx wrangler secret put SUPABASE_PUBLISHABLE_KEY`, and `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (from `cloudflare/`). These are encrypted Worker secrets. Do not put provider credentials in `wrangler.jsonc`.
4. Apply account schema changes with `npx wrangler d1 migrations apply vumiro-account-data --remote` and deploy the public Worker with `npm run deploy`. Migration `0006` adds durable deletion jobs, notice evidence, and account rate-limit state.
5. Add rate limits for Supabase Auth endpoints and the Worker `/api/v1/account/*` routes in the provider/Cloudflare controls. Configure production email delivery, monitoring, deletion/backup expectations, controller identity, lawful-basis analysis, and a monitored privacy contact before inviting testers.
6. Set `ACCOUNT_SERVICE_ENABLED=true` only after existing-account sync is staged successfully. Only after the privacy and security setup is complete, set `ACCOUNT_REGISTRATION_ENABLED=true`. Store both with `npx wrangler secret put NAME`.

Until the required provider values are configured and `ACCOUNT_SERVICE_ENABLED=true`, the account API returns `503`. `ACCOUNT_REGISTRATION_ENABLED` independently controls new sign-ups so existing accounts can keep syncing while registration is paused. A password-reset and identity-recovery flow should be checked with the configured real email template before release.

The public Worker is `vumiro-rooms`. Its Durable Object bindings reference the existing `screentask-rooms` storage owner directly, retaining the same namespace IDs and stored friend requests. That legacy resource name is an internal compatibility identifier, not a public service URL. Do not recreate its namespaces. Original migration history lives in `wrangler.storage.jsonc`; the storage owner has no public workers.dev route. `npm run deploy` updates both scripts, with no proxy hop or extra service polling.

The account's workers.dev subdomain is `vumiro-signaling`. Renaming that account subdomain retires the old `screentask-room-signaling` URLs. Older installed clients can still download their GitHub update; both peers should update before using the new address.

Runtime tests are deferred to the user for this iteration. Compilation, JavaScript syntax and deployment checks do not claim an end-to-end/security audit. Service usage remains subject to the account's Cloudflare limits.
