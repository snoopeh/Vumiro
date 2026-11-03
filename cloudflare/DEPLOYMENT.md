# Active Vumiro deployment

## Account service and 1.21.7 publication — 2026-11-03

The canonical [public service](https://vumiro-rooms.vumiro-signaling.workers.dev) returns **200** from `/api/v1/account/config`, with **service enabled**. The deployed Worker reports **new registration enabled**, verified after deployment. Supabase **Allow new users to sign up** is already **enabled**, with confirmed email required. Hosted Google/Microsoft sign-in remains disabled and unverified.

**Brevo Free SMTP is connected using encrypted transport** (**300 emails/day**). Required verification and SMTP credential generation are complete. Confirmation and recovery templates are saved with `{{ .Token }}` codes and no action links/assets. Password-change and email-change security notifications are enabled. Actual signup delivery/OTP verification, recovery/password change/new-password login, Worker enrollment and account deletion passed. This delivered-email evidence is separate from the admin-confirmed hosted fixtures.

Brevo settings show **all senders, one month of transactional logs**, and **Never store previews**. Delivered messages use **Vumiro <snopeeh@12660220.brevosend.com>** after Gmail sender-domain rewriting. The completed [privacy notice](../docs/PRIVACY.md), version **2026-11-01**, names **Emanuel Queiroz (snoopeh)** and **snopeeh@gmail.com** and explains actual regions, readable account fields, encrypted identity backup, deletion and provider-retention limitations.

The **46/46** regression suite and local **1.21.7** package checks passed. The completed publication evidence is recorded below. These checks do **not** establish full installed-desktop restart, real-device identity restore or audio/screen hardware QA.

Production authentication is Supabase project `rrrflwevxojheaejbcnp`, AWS **São Paulo (`sa-east-1`)**, at `https://rrrflwevxojheaejbcnp.supabase.co`, reported Healthy. Seven encrypted Worker secrets are installed. Signing uses **ES256**, verified JWKS key ID `5037f2b1-3679-4872-b5d3-f1220e4de221`; access tokens last **3600 seconds**. Refresh-token reuse detection uses a **10-second** interval. Passwords require **12 characters**; OTPs use **6 digits**, expire after **600 seconds**, and secure password change is enabled. The canonical `/auth.html` Site URL and desktop loopback redirect allowlist are saved.

The hosted smoke script passed password login/refresh, two-device enrollment, credential enforcement, snapshot write/read and revision conflict **409**, export/notice evidence, secondary snapshot restore, revocation **401/403**, provider identity deletion **404**, completed tombstone **410**, and cleanup. Both synthetic admin fixtures were cleaned up. One extra unverified mail-test fixture remains because automatic approval review rejected cleanup; track that minor cleanup separately from the successful real email flows.

Public dependencies are checked every30minutes through GitHub Actions; the first run passed. Failed-run notifications follow GitHub preferences. Provider logs and deletion retries still need manual checks; no separate email/pager destination is configured. Watch deletion retries, provider failures, rate limits and Brevo's daily allowance during rollout. See [ACCOUNT-LAUNCH.md](../.planning/ACCOUNT-LAUNCH.md) for the detailed evidence and [ACCOUNT-OPERATIONS.md](../docs/ACCOUNT-OPERATIONS.md) for operating procedures.

## Current account architecture

- Separate D1 database `vumiro-account-data` (`eac4972c-d270-4931-8308-59fc851337f8`), region **ENAM**, with migrations **0001–0006** applied remotely and no pending migrations.
- Migration `0005` provides hashed per-device credentials and retryable deletion state. Migration `0006` provides durable retry metadata, notice evidence and account rate-limit windows. Pending deletion jobs remain until completion; completed token-blocking records expire after two hours and hourly cleanup removes eligible rows.
- Protected operations require a server-issued device credential. The Worker verifies signed recent-authentication timestamps, supports ES256/RS256 tokens and retries provider deletion. The client stores only an encrypted identity-recovery envelope remotely; updated friends verify signed identity transitions.
- The account edge rate-limit binding is **120 requests/minute per connecting IP**, alongside per-account operation limits. Redacted observability is enabled; invocation logging and tracing are disabled.
- `wrangler.jsonc` binds account D1 only to the public Worker. Original Durable Object names, IDs and migrations remain unchanged.
- Follow [account auth configuration](README.md#account-auth-configuration) for configuration details. Keep social providers and unsupported CAPTCHA enforcement off until their client flows are supported and verified.

## Historical account-source publication — 2026-11-02

Source `1c3a9073fda4b9be07fbe3f3bfdf2e9cf50efef4` passed [Windows/Linux build CI `41539684948`](https://github.com/snoopeh/Vumiro/actions/runs/41539684948). Earlier publication deployed public Worker version `d7e5ac0a-cd61-4efa-ae7e-d39c44bc776d` and storage owner version `2fb21cd5-bc06-4700-9e57-6d9efe206e45`. Secrets and feature gates changed afterward. These are historical code-publication records, not the final 1.21.7 release/configuration inventory.

## Historical desktop and signaling baseline — 1.21.1

The following records the earlier 1.21.1 deployment, not a new release from the account provisioning work above.

- Published/deployed: 2026-11-01.
- Source release tag: `client-v1.21.1`.
- Windows and Linux release: https://github.com/snoopeh/Vumiro/releases/tag/client-v1.21.1
- Build/release workflows: https://github.com/snoopeh/Vumiro/actions
- Local Windows package: `../dist/vumiro-1.21.1/Vumiro-win-x64.zip`. Linux AppImage/deb/rpm packages build in Ubuntu CI. Published checksums accompany the release assets.
- Both Windows executables use version 1.21.1.0; Linux package version is 1.21.1. Windows packaging retains the existing six-web-asset allowlist for updater compatibility.
- Public Worker: `vumiro-rooms`, version `45b506db-b76e-4aa7-85b4-0be93079571f`.
- Internal storage owner: `screentask-rooms`, version `cbc3d285-c3ec-4d2e-b1cf-7613b3a1f864`. Its public workers.dev route is disabled; its original v1/v2 migrations are retained in `wrangler.storage.jsonc`.
- Windows stream audio is captured locally using WASAPI; audio and Discord filtering add no service endpoints or cloud polling.
- Linux's exact local origin `vumiro://app` is permitted alongside the existing Windows origin.
- Service: https://vumiro-rooms.vumiro-signaling.workers.dev
- Endpoints: `/friends-signaling`, `/call-signaling`.
- Bindings: `CALL_ROOMS` (CallRoom), `FRIEND_DIRECTORY` (FriendDirectory), `ASSETS` (allowlisted client assets).
- The account workers.dev subdomain is now `vumiro-signaling`, changed through the Cloudflare dashboard. Public Worker bindings point directly to the original namespaces: `CALL_ROOMS` → `94c55c72903c4d80b15a6c620e3ef41b`, `FRIEND_DIRECTORY` → `9902bed8deae4a09b81cdb67f985d3dd`. Both IDs were verified unchanged after deployment. No data transfer, replacement namespace or proxy hop was introduced.
- Desktop identity origins and local storage remain stable. The existing SQLite FriendDirectory keeps bounded version 2 friend-request proofs and public identities: 24-hour pending lifetime, up to seven days for terminal replay, early deletion after both receipts. No private keys, pictures, chat or media are stored.
- New friend states are pushed over the existing WebSocket. Reconnection replay uses indexed identity lookups; one-shot alarms target actual expirations. No periodic network polling was added. Legacy version 1 traffic remains available, but both peers need 1.19 for durable requests.
- Runtime behavior is left to user feedback as requested; no runtime test suite or app-driven QA was run.

The [pre-cleanup restore point](../docs/RESTORE.md) contains the committed/pushed original source, a verified all-history bundle, full ignored-file snapshot and separate closed-app local profile copy.

## Completed 1.21.1 URL migration

Client 1.21.1 is published as the stable/latest release with all six assets. Release CI `41341372589` succeeded. The app remaps known legacy saved URLs and room invitations while preserving custom connection services. Older clients need the GitHub update because the account rename retires the old service URLs.

The dashboard confirmed the new subdomain and Wrangler deployed the canonical route. API metadata confirmed the public route enabled, internal storage route disabled, and original Durable Object bindings retained. No live room/audio runtime tests were run.

## Publication completed — 2026-11-03

Source `4eb6963` is tagged [client-v1.21.7](https://github.com/snoopeh/Vumiro/releases/tag/client-v1.21.7). [Release CI41573912179](https://github.com/snoopeh/Vumiro/actions/runs/41573912179) passed Windows and Linux; all seven expected assets are published. [Main CI41573829233](https://github.com/snoopeh/Vumiro/actions/runs/41573829233) also passed. Public Worker code version `99f524a2-db20-41cb-aff2-348189daee21` and internal storage version `f408d741-ed26-4edb-90f6-258c40bc0b3b` deployed with original bindings. A subsequent encrypted-secret update enabled registration; live config confirms both service and registration true, social providers empty.

Public health monitoring is now in `.github/workflows/account-health.yml`, every30minutes, with no user credentials. The manually dispatched [first run41574144529](https://github.com/snoopeh/Vumiro/actions/runs/41574144529) succeeded. Failed runs use GitHub Actions notification preferences; a separate email/pager channel and deletion-queue alerts are not yet configured.
