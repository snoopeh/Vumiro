# Account service launch — 1.21.7

Status recorded: **2026-11-03**, publication completed; Google and Microsoft subsequently enabled on the same date. The 1.21.7/1.21.8 publication records below preserve their original configuration states; the current rollout state and social-provider section supersede their disabled-provider statements.

## Rollout state

- The canonical [public service](https://vumiro-rooms.vumiro-signaling.workers.dev) returns **200** from `/api/v1/account/config`, with `serviceEnabled: true`. The deployed Worker now reports `registrationEnabled: true`; verified-email registration is enabled. The flag was checked after deployment.
- Supabase **Allow new users to sign up** is now **enabled**, independently of the Worker flag. **Confirm email** remains enabled. Google and Microsoft are now enabled in Supabase and both Worker flags; live configuration advertises `["google", "azure"]`. Real authorization-code/PKCE acceptance passed for both providers. Brand/publisher verification and full installed-desktop/device acceptance remain separate outstanding items.
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
- Regression suite at **1.21.7**: **46/46 passed**. Local **1.21.7** package checks passed. Earlier native OAuth callback checks passed **18/18**. Social providers were disabled and real round trips unverified at that release; the subsequent social-provider acceptance below supersedes that state.
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

## Original publication follow-through — historical

This was the plan before 1.21.7 publication. Its publication and social-provider gating steps are superseded by the completed records below; remaining desktop/device acceptance and alert work are still open.

1. Publish the prepared compatible source, Worker and desktop release; record commit/tag, CI/release URL and current Worker version.
2. Verify live `/api/v1/account/config` reports the intended registration flag, and verify packaged notice/assets. Supabase signup is already enabled.
3. Keep social providers disabled, monitor the limited rollout manually, and resolve the remaining unverified fixture cleanup through the provider's supported path.
4. Perform and record the remaining installed-desktop/device acceptance checks separately; configure push alerts when the delivery channel is ready.

## Publication completed — 2026-11-03

Source `4eb6963` is tagged [client-v1.21.7](https://github.com/snoopeh/Vumiro/releases/tag/client-v1.21.7). [Release CI41573912179](https://github.com/snoopeh/Vumiro/actions/runs/41573912179) passed Windows and Linux; all seven expected assets are published. [Main CI41573829233](https://github.com/snoopeh/Vumiro/actions/runs/41573829233) also passed. Public Worker code version `99f524a2-db20-41cb-aff2-348189daee21` and internal storage version `f408d741-ed26-4edb-90f6-258c40bc0b3b` deployed with original bindings. A subsequent encrypted-secret update enabled registration; config at that publication confirmed both service and registration true, social providers empty. The later provider enablement below supersedes that empty list.

Public health monitoring is now in `.github/workflows/account-health.yml`, every30minutes, with no user credentials. The manually dispatched [first run41574144529](https://github.com/snoopeh/Vumiro/actions/runs/41574144529) succeeded. Failed runs use GitHub Actions notification preferences; a separate email/pager channel and deletion-queue alerts are not yet configured.

## Interface release completed — 1.21.8

Source `0826933` is tagged [client-v1.21.8](https://github.com/snoopeh/Vumiro/releases/tag/client-v1.21.8). [Release CI 41575384805](https://github.com/snoopeh/Vumiro/actions/runs/41575384805) and [main CI 41575373132](https://github.com/snoopeh/Vumiro/actions/runs/41575373132) passed Windows and Linux. All seven expected assets have positive sizes and published SHA-256 digests.

The 1.21.8 public Worker code version was `ecf57d68-409b-492b-8321-764a83a512b8`; internal storage owner was `6cbc8f79-ee73-40fb-a895-5791abcb0364`. Original bindings were retained. All nine served web assets matched committed source byte-for-byte. At that deployment, account service and registration remained enabled and social providers remained disabled. Later secret/configuration updates enabled both social providers as recorded below.

The release adds compact navigation, the profile/account disclosure and explicit local account logout, Voice & audio device preferences/tests, supported speech processing, master playback and deafen. There are 73 passing automated regressions. Independent media review and Windows build/package checks passed. Browser review confirmed disclosure keyboard/focus behavior, audio entry without capture, pending-request closure and preference persistence. Physical audio-device/platform acceptance and installed-desktop two-device account acceptance remain outstanding; they are not inferred from mocks or package validation.

## Google and Microsoft enabled — 2026-11-03

Both providers are enabled in Supabase. Encrypted Worker flags `ACCOUNT_OAUTH_GOOGLE_ENABLED` and `ACCOUNT_OAUTH_MICROSOFT_ENABLED` are now `"true"`; live `/api/v1/account/config` returns `oauthProviders: ["google", "azure"]` with service and registration still enabled. Existing **1.21.8** clients receive the options after a reload/restart; provider configuration does not require another desktop binary release.

- Google Cloud project: **vumiro-accounts**. OAuth web client: `963352735641-jfapfk6k71f12e4ptk4l37e1fiktqtvd.apps.googleusercontent.com`. Audience **External**, publishing status **In production**; Data Access explicitly saved with only non-sensitive `openid email profile` scopes. Google brand verification remains unverified.
- Microsoft Entra tenant: `5f032e19-a8b2-48a0-a72b-0cb99898f440`. Application/client ID: `a2676974-ebbd-4266-a0bf-726cb6c585d8`. Audience `AzureADandPersonalMicrosoftAccount`; Supabase Azure tenant endpoint **common**. ID-token claims `email` and `xms_edov`, plus access-token `xms_edov`, were saved in the registration. Default Graph `User.Read` was removed, leaving only delegated Graph `email` (administrator consent not intrinsically required). Homepage and privacy branding URLs point to the public GitHub project and notice. Publisher remains unverified.
- Both providers use the Web callback `https://rrrflwevxojheaejbcnp.supabase.co/auth/v1/callback`. Supabase's desktop redirect allowlist remains `http://127.0.0.1:43821/vumiro-auth/**`. No provider secret was committed or included in client assets.
- Microsoft credential expiration: **2027-05-02**; planned rotation deadline **2027-04-02**. [The operations runbook](../docs/ACCOUNT-OPERATIONS.md#provider-credential-rotation) records the replacement, validation and retirement procedure. No automatic reminder or Google secret expiry is implied.

**Real production acceptance passed independently for Google and Microsoft personal accounts:** provider authorization and randomized loopback callback, PKCE code exchange, authenticated `/user` and matching provider identity, fresh `oauth` AMR, refresh retaining the same immutable account ID, and local-scope test-session logout. The reusable command is `node scripts/Test-OAuthProvider.mjs --provider google` or `--provider azure`; `--check` performs only fixture/listener, incorrect-transaction rejection and cancellation checks. Codes, PKCE verifiers and tokens remain in memory; the harness does not enroll devices, read user stores or delete identities.

Microsoft passed the complete real flow again after the permission reduction. Google passed again after publication and saving its scope declarations. The three Electron OAuth regressions and 18 native Windows callback checks also passed. The live public login page was checked after configuration loaded and both Google/Microsoft buttons were enabled. Ignored local screenshot evidence: `dist/social-login-setup/providers-live.jpg`.

The harness uses the **production Electron callback/listener through a VM fixture**, intercepting only the external-browser launch. These are real hosted provider flows, but they do not establish full installed Windows/Linux UI and secure-storage acceptance or second-device encrypted-identity restoration. No actual Microsoft work/school fixture was available; organizational consent can require tenant administrator approval. Full platform/device acceptance, denial/timeout scenarios and organization-specific consent remain separate follow-through work.

## Account and settings refinement — 1.21.9

The 2026-11-03 UX pass adds a minimal login, aligned logo and embedded Outfit typography; full-window settings navigation; grouped account actions; signout-to-login navigation; returning-user notice reuse without fabricated acceptance; automatic signup verification entry; native Windows caption double-click; and OAuth app activation plus best-effort browser-tab closure. Existing package filenames and updater allowlists are preserved. See [the refinement record](../docs/UX-REFINEMENT-1.21.9.md).

Final local verification passed: **70 client regressions**, **16 backend tests**, **26 native callback/caption checks**, JavaScript syntax checks, Windows Release build with no warnings/errors, and frozen-bridge/full-v2 package validation. Linux preparation copied all nine current shared assets and legal notices. Fresh local Windows artifacts are under ignored `dist/client-1.21.9-final`; earlier QA artifacts are superseded.

CUA browser QA used an isolated fixture with disposable mock credentials: narrow 390px layout without horizontal overflow, signup confirmation/privacy and policy hint, recovery navigation, full-window profile/account/audio/sharing/connection/update sections, cross-dialog draft retention and fresh rendering after complete close, Escape/titlebar restoration, and signout returning to login. Local visual evidence is under ignored `dist/ux-1.21.9`. This is separate from real installed native focus, hardware and cross-device acceptance; browser auto-close remains subject to browser restrictions.

Publication completed: source `9b1492b` is tagged [client-v1.21.9](https://github.com/snoopeh/Vumiro/releases/tag/client-v1.21.9). [Main CI 41630995299](https://github.com/snoopeh/Vumiro/actions/runs/41630995299) and [release CI 41630999856](https://github.com/snoopeh/Vumiro/actions/runs/41630999856) passed Windows and Linux; the release publication job succeeded. All seven expected release assets have positive sizes and published SHA-256 digests. The release body describes the final changes and browser tab-closing limitation.

Public Worker version `15893d91-d6a1-463a-984f-6c043472f7b0` and internal storage owner version `cb6edfad-fb1a-4e82-96ae-85323a49766e` deployed with the original bindings retained. All nine served client assets match source byte-for-byte. Live configuration confirms service and registration enabled with providers `["google", "azure"]`. CUA verified both provider buttons enabled on the deployed minimal login; final public visual proof is under ignored `dist/ux-1.21.9/login-live.jpg`.
