# Account service launch — 2026-11-02

## Provider setup

- Cloudflare session is available for the existing account. The account Worker currently has no secrets; `/api/v1/account/config` returns 503 with both gates false.
- Remote D1 migrations 0001–0006 are applied; Wrangler reports no pending migrations.
- Created the free Supabase organization **Vumiro**, ID `wuveytlxlgvtucznraxp`, in the user's signed-in Codex browser session.
- Prepared the project creation form for **vumiro-accounts-production**, region **South America (São Paulo), sa-east-1**, Data API disabled, generated database password. **Project creation has not been submitted.** Browser policy requires action-time confirmation for persistent credential creation; an asynchronous confirmation is pending.
- Supabase/SMTP secrets are not configured. Production sender/domain and operator/privacy contact are still unknown; no Cloudflare DNS zones were returned by the existing account.
- Do not claim accounts are live or enable public registration until the actual provider and email flow are tested and the operator notice fields are completed.

## Completed code and verification

- Fixed unknown-signing-key refresh after provider key rotation. Refreshes are coalesced and throttled; known cached keys remain usable after a refresh failure.
- Fixed pending identity deletion being presented as completed. Backend 202 carries `deletionPending`; client handles current and older pending responses.
- Added edge rate-limit binding for account requests (120/minute per connecting IP), preserving CORS and Retry-After behavior. Existing per-account D1 operation limits remain.
- Enabled public Worker observability with invocation logs/traces disabled and query redaction. Operator alert delivery remains to be configured.
- Added actual SQLite/migration integration tests for enrollment, credentials, sync conflict, export evidence, isolation, revocation, deletion, and maintenance retries. No production account records were written by these tests.
- Prepared `cloudflare/supabase-email.html` for OTP confirmation/recovery templates. It is excluded from the public web-asset allowlist.
- Backend suite: 16/16 pass. Combined account/client/identity/OAuth suite before the final edge/integration additions: 37/37 pass. Native OAuth callback checks: 18/18 pass. Public Worker dry-run with rate-limit binding passes.

## Published source and Worker

- Source `1c3a9073fda4b9be07fbe3f3bfdf2e9cf50efef4` pushed to main. Build CI `41539684948` is in progress at this handoff; no new desktop tag/release was created.
- Public Worker `vumiro-rooms` deployed as `d7e5ac0a-cd61-4efa-ae7e-d39c44bc776d`; internal storage owner `screentask-rooms` deployed as `2fb21cd5-bc06-4700-9e57-6d9efe206e45`. Original Durable Object bindings retained.
- Live smoke checks: account config 503 with service/registration false; desktop CORS preflight 204; untrusted origin 403; changed pending-deletion client asset is served. This deploy publishes hardening, **not usable hosted accounts**.

## Continue

1. Submit the prepared Supabase project after the pending action-time confirmation; capture its actual project reference and region.
2. Configure verified-email/password auth, ES256/RS256 JWTs, one-hour access tokens, 12-character minimum password, signup/recovery OTP templates, provider rate limits, and secure refresh defaults. Leave social providers disabled. Enforced CAPTCHA is incompatible with current clients.
3. Configure a real SMTP sender, then install Supabase URL/publishable/admin values in encrypted Worker secrets. Never print, commit, or package admin/SMTP credentials.
4. Verify hosted signup/OTP, recovery, JWT/device enrollment, sync/restore, revocation, export and deletion. Local provider mocks are not hosted evidence.
5. Complete operator/privacy details and alert delivery, enable the service, and open registration only after acceptance passes. Publish compatible desktop changes and update this record with actual deployed versions and test evidence.
