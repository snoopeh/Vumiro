# Account service launch — 1.21.7

Status recorded: **2026-11-03**, publication completed.

## Rollout state

- The canonical [public service](https://vumiro-rooms.vumiro-signaling.workers.dev) returns **200** from `/api/v1/account/config`, with `serviceEnabled: true`. The deployed Worker now reports `registrationEnabled: true`; verified-email registration is enabled. The flag was checked after deployment.
- Supabase **Allow new users to sign up** is now **enabled**, independently of the Worker flag. **Confirm email** remains enabled. Google/Microsoft sign-in remains disabled and unverified.
- Version **1.21.7** has passed local package checks and the **46/46** regression suite. Release commit, deployment, tag and published release evidence are recorded below. Local packaging is not evidence of a published release or full desktop runtime acceptance.

## Provider and operator configuration

- Production Supabase project **vumiro-accounts-production**, reference `rrrflwevxojheaejbcnp`, is in the **Vumiro** organization (`wuveytlxlgvtucznraxp`), AWS **São Paulo (`sa-east-1`)**, reported Healthy. Auth URL: `https://rrrflwevxojheaejbcnp.supabase.co`.
- Seven encrypted Worker secrets are installed. Secret values were not printed, committed or included in client assets.
- Minimum password length **12**; email OTP **6 digits**, expiry **600 seconds**; secure password change enabled. Password-change and email-change security notifications are enabled.
- Signing uses **ES256**, verified JWKS key ID `5037f2b1-3679-4872-b5d3-f1220e4de221`; access tokens last **3600 seconds**. Refresh-token reuse detection is enabled with a **10-second** reuse interval.
- Supabase Site URL is the canonical `/auth.html`; the desktop loopback redirect allowlist is saved. CAPTCHA enforcement remains off because current clients cannot supply a CAPTCHA token.
- Remote D1 migrations **0001–0006** are applied, with no pending migrations. Account database `vumiro-account-data` remains in **ENAM**.
- **Brevo Free SMTP is connected to Supabase using encrypted transport**, with **300 emails/day** allowance. Sender verification and the human verification needed to generate SMTP credentials were completed. Confirmation and recovery templates are saved with `{{ .Token }}` codes and no template action links or assets.
- Brevo's tested delivered sender is **Vumiro <snopeeh@12660220.brevosend.com>**, rewritten from the verified Gmail sender. Retention settings show **all senders, one month**, and **Never store previews**. This does not establish zero aggregate email tracking or immediate removal of every provider backup/security record.
- The published account notice identifies **Emanuel Queiroz (snoopeh)** as operator and **snopeeh@gmail.com** as the privacy/incident contact, retaining notice version **2026-11-01**. It records actual regions, operator-readable account fields, encrypted identity backup, deletion retries, retention and provider uncertainties. No private postal address or phone is included. See [PRIVACY.md](../docs/PRIVACY.md).

## Completed verification

- **Real end-user email flow passed:** signup email delivered, six-digit OTP verified, authenticated session established, recovery email/code accepted, password changed, and login with the new password succeeded. Worker enrollment and account deletion also passed. This is separate from the synthetic admin fixtures below.
- The hosted smoke script passed password login, asymmetric session, refresh, primary/secondary enrollment, device-credential enforcement, snapshot write/read, stale revision **409**, export and authoritative notice evidence, second-device snapshot restore, revocation with **401/403**, revoked-device enrollment **403**, real deletion, provider identity **404**, completed tombstone **410**, and cleanup.
- Both synthetic admin-created fixture accounts were cleaned up. One additional unverified email-test fixture remains because automatic approval review rejected its cleanup request; this is minor outstanding test-data cleanup, not a failed delivered signup/recovery acceptance check.
- The initial synthetic export assertion exposed PowerShell timestamp conversion. The assertion now compares UTC instants and the full hosted rerun passed.
- Regression suite: **46/46 passed**. Local **1.21.7** package checks passed. Earlier native OAuth callback checks passed **18/18**, but live Google/Microsoft consent round trips remain unverified and disabled.
- Public Worker dry-run with the edge rate-limit binding passed. Earlier deployed checks passed desktop CORS **204**, untrusted-origin rejection **403**, and delivery of pending-deletion handling assets.

## Hardening and operating limits

- Unknown-signing-key refresh is coalesced and throttled; known cached keys remain usable after a refresh failure. Pending deletion is reported as pending and retried until provider deletion completes.
- Account requests use the edge binding (**120/minute per connecting IP**) plus durable per-account operation limits. Worker observability is enabled with invocation logs/traces disabled and URL queries redacted.
- Public dependency monitoring is scheduled through GitHub Actions; delivery of failed-run notifications follows GitHub preferences. Provider dashboards and deletion retries remain manual checks, without a separate email/pager channel. Check deletion retries, provider errors, abuse/rate limits and Brevo's daily allowance during the limited rollout.
- Full installed-desktop restart/session persistence, interactive encrypted-identity restore across real devices, and microphone/screen/audio hardware QA have **not** been established by the hosted API or package checks. Do not report them as passed.
- Operator procedures and provider/legal follow-up remain in [ACCOUNT-OPERATIONS.md](../docs/ACCOUNT-OPERATIONS.md). The notice makes no legal certification or verified Brazilian international-transfer-mechanism claim.

## Historical publication evidence

These records predate the 1.21.7 release publication and do not identify its final deployed configuration:

- Source `1c3a9073fda4b9be07fbe3f3bfdf2e9cf50efef4` was pushed to main. [Build CI `41539684948`](https://github.com/snoopeh/Vumiro/actions/runs/41539684948) succeeded for Windows/Linux; that build was not itself a new desktop release.
- Earlier public Worker version: `d7e5ac0a-cd61-4efa-ae7e-d39c44bc776d`; internal storage owner version: `2fb21cd5-bc06-4700-9e57-6d9efe206e45`. Original Durable Object bindings were retained. Secrets and flags changed afterward.

## Immediate publication follow-through

1. Publish the prepared compatible source, Worker and desktop release; record commit/tag, CI/release URL and current Worker version.
2. Verify live `/api/v1/account/config` reports the intended registration flag, and verify packaged notice/assets. Supabase signup is already enabled.
3. Keep social providers disabled, monitor the limited rollout manually, and resolve the remaining unverified fixture cleanup through the provider's supported path.
4. Perform and record the remaining installed-desktop/device acceptance checks separately; configure push alerts when the delivery channel is ready.

## Publication completed — 2026-11-03

Source `4eb6963` is tagged [client-v1.21.7](https://github.com/snoopeh/Vumiro/releases/tag/client-v1.21.7). [Release CI41573912179](https://github.com/snoopeh/Vumiro/actions/runs/41573912179) passed Windows and Linux; all seven expected assets are published. [Main CI41573829233](https://github.com/snoopeh/Vumiro/actions/runs/41573829233) also passed. Public Worker code version `99f524a2-db20-41cb-aff2-348189daee21` and internal storage version `f408d741-ed26-4edb-90f6-258c40bc0b3b` deployed with original bindings. A subsequent encrypted-secret update enabled registration; live config confirms both service and registration true, social providers empty.

Public health monitoring is now in `.github/workflows/account-health.yml`, every30minutes, with no user credentials. The manually dispatched [first run41574144529](https://github.com/snoopeh/Vumiro/actions/runs/41574144529) succeeded. Failed runs use GitHub Actions notification preferences; a separate email/pager channel and deletion-queue alerts are not yet configured.
