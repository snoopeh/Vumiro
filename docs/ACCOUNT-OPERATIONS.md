# Vumiro account operations

This runbook records operating procedures and acceptance requirements for Vumiro accounts. Email/password, Google and Microsoft registration are live as of **2026-11-03**; [the launch record](../.planning/ACCOUNT-LAUNCH.md) distinguishes completed hosted checks from outstanding installed-desktop, hardware and operational acceptance. Unchecked items here must not be reported as completed. This runbook does not replace legal review.

## Required operator information

Record these values in the published privacy notice before launch:

- Controller legal name, registration number when applicable, and business address.
- Monitored privacy-rights contact and the person or team responsible for responding.
- Whether an encarregado is appointed. A small processing agent that does not appoint one still needs a working data-subject channel.
- A lawful basis for each purpose: authentication, session and device security, profile sync, contact and block-list sync, recovery email, fraud prevention, security logs, and deletion records.
- Minimum user age and the process for children or adolescents, if they are permitted.
- Cloudflare, Supabase, and transactional-email provider legal entities, processing regions, subprocessors, contract/DPA references, retention, and deletion behavior.
- The LGPD international-transfer mechanism used for each transfer outside Brazil.

The privacy checkbox records acknowledgement of the notice. Do not describe it as consent unless a reviewed purpose actually relies on consent and withdrawal is implemented without making an unrelated service unusable.

### Profile cards and friend directory — notice 2026-11-03

The bundled notice and account API advertise version **2026-11-03**. Existing users may sign in without a repeated acknowledgement; sign-in must not fabricate acceptance of a new version. Signup requires acknowledgement, and an account without a current recorded acknowledgement must review it before backup or sync resumes.

The configuration request also advertises `X-Vumiro-Profile-Cards: 1`. Clients without this capability receive the legacy **2026-11-01** notice version matching their bundled prose, so they cannot record a review of text they cannot display. Legacy snapshot writes bearing that old notice return **426** with an update instruction; sign-in, data reads/restoration, export and account deletion remain available. Current clients also refuse new signup or backup acknowledgement if the server later requires a notice newer than their bundled copy. This does not block existing-account sign-in.

Optional own-profile bios, backgrounds and manually entered provider links are backed up with the owner's profile and exchanged directly with connected friends. These links are user-supplied and unverified; no provider access token, mailbox permission or external-account verification is implied. Cached friend pictures, bios, backgrounds and links remain excluded from account snapshots. `X-Vumiro-Profile-Cards: 1` negotiates the extended snapshot profile. Legacy reads omit these optional keys, legacy writes preserve previously saved values under the same revision check, and account exports retain all fields.

The friend directory stores durable identity-to-friend-tag assignments and a `from_id`/`to_id` migration replay mapping, separately from the Supabase account database. These rows have no automatic expiry; Supabase account deletion does not remove them, and no in-app deletion tool exists. Rights-request handling must identify directory records separately and record the actual action taken rather than reporting them deleted after an account deletion. Do not request private keys to prove a request.

Friend-tag allocation quotas use an hourly hash of the connecting IP and hour, count and expiry. Their rows expire at the next hourly boundary and are pruned by directory alarms or subsequent operations, subject to outages. The allocation table does not store raw IP addresses; provider network/security processing is separate. Pending friend requests remain until signed expiry; answered or cancelled requests are normally retained seven days for delivery and replay handling. Tag assignments and migration replay rows are not included in that expiry policy.

## Provider launch configuration

1. Create a production Supabase project in the selected region.
2. Require email confirmation and asymmetric JWT signing. Record the issuer, audience, signing algorithms, token lifetime, and key-rotation process.
3. Configure production SMTP or an approved Send Email hook. Include the OTP token in signup and recovery templates, disable provider link tracking, and enable password/email-change security notifications.
   The shared code-only template is `cloudflare/supabase-email.html`; use it for confirmation and recovery with separate subjects. The desktop app accepts codes, not provider callback links.
4. Configure password policy, Auth rate limits, CAPTCHA or equivalent bot controls, session lifetime, refresh-token reuse detection, and account-enumeration-safe messages.
5. Put `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in encrypted Worker secrets. Never store the service-role key in the repository, desktop package, logs, or support tooling.
6. Configure Cloudflare rate limits for `/api/v1/account/*`, security-event logging, alerts, and an account-service dashboard. Logs must avoid tokens, passwords, OTPs, profile payloads, and device credentials.
   The public Worker config includes `ACCOUNT_API_RATE_LIMITER`: 120 requests per minute per connecting IP, before JWT validation, in addition to durable per-account operation limits. Cloudflare's binding counters are local to each edge location and are approximate. The public Worker enables logs with invocation logging and tracing disabled and URL queries redacted; configure operator alert delivery separately. Do not enable Supabase CAPTCHA until the desktop app can supply a `captcha_token`; use provider rate limits with the current clients.
7. Keep account service availability separate from new registration. Existing users must retain export, deletion, and sync access if registration is paused.

### Google and Microsoft sign-in

The dedicated desktop sign-in page supports Google, Microsoft, and Vumiro email/password accounts. The social buttons stay disabled until the account service advertises the corresponding provider. No provider client secret belongs in a client package.

1. Configure a Google OAuth web client and the Google consent screen. Set its authorized redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`, then enter its client ID and secret in the Supabase Google provider settings. Request only `openid email profile`.
2. Register the Microsoft application in Entra. Choose the supported personal/work account and tenant policy deliberately. Add the same Supabase callback as a **Web** redirect URI, then configure the application ID, secret and tenant in the Supabase Azure provider. Supabase calls this provider `azure`; Vumiro requests its required `email` scope.
3. In the Supabase redirect allowlist, add `http://127.0.0.1:43821/vumiro-auth/**`. Vumiro binds only IPv4 loopback on this port and generates a random callback path for each transaction. Provider credentials are entered in the external system browser. Only a one-use authorization code returns to the app, which exchanges it with an in-memory PKCE verifier.
4. Keep `ACCOUNT_OAUTH_GOOGLE_ENABLED` and `ACCOUNT_OAUTH_MICROSOFT_ENABLED` false until each provider has passed a real desktop round trip. Then set the corresponding Worker flag to `"true"`. Keep new-user creation restrictions aligned in Supabase as well as `ACCOUNT_REGISTRATION_ENABLED`; disabling the Vumiro registration UI alone does not prevent provider-side account creation.
5. Test consent denied, timeout, occupied callback port, browser closed, wrong account during sensitive-action reauthentication, restart persistence, and both new and existing accounts. A social account needs a separate Vumiro backup password or its identity recovery code to restore the encrypted signing identity on another device.

#### Production configuration — 2026-11-03

Both providers are enabled in Supabase and the encrypted Worker flags `ACCOUNT_OAUTH_GOOGLE_ENABLED` and `ACCOUNT_OAUTH_MICROSOFT_ENABLED` are `"true"`. Live `/api/v1/account/config` advertises `oauthProviders: ["google", "azure"]`. Existing **1.21.8** clients obtain the enabled options after reloading or restarting; no new desktop binary is required for this configuration change.

| Setting | Google | Microsoft |
| --- | --- | --- |
| Registration | Google Cloud project `vumiro-accounts` | Entra tenant `5f032e19-a8b2-48a0-a72b-0cb99898f440` |
| Public application/client ID | `963352735641-jfapfk6k71f12e4ptk4l37e1fiktqtvd.apps.googleusercontent.com` | `a2676974-ebbd-4266-a0bf-726cb6c585d8` |
| Audience | External, **In production** | `AzureADandPersonalMicrosoftAccount`, Supabase tenant endpoint **common** |
| Requested scopes | `openid email profile` | `email` |
| Additional token claims | Standard basic identity claims | ID token: `email`, `xms_edov`; access token: `xms_edov` |
| Brand/publisher verification | Brand remains unverified | Publisher remains unverified |

Google Data Access was explicitly saved with only the three non-sensitive email, profile and OpenID scopes. The Microsoft registration's default Microsoft Graph `User.Read` permission was removed; its configured Graph permission is only delegated `email` (the permission does not intrinsically require administrator consent). Microsoft homepage/privacy branding URLs were saved to the public GitHub project and notice. Organizational policies can still impose administrator approval independently of that permission setting.

Both registrations use the Web callback `https://rrrflwevxojheaejbcnp.supabase.co/auth/v1/callback`. Supabase then returns the single-use authorization code to the randomized desktop loopback allowlist described above. Credentials are stored in Supabase provider configuration; none are recorded here or shipped to clients.

Real Google and Microsoft **personal-account** flows passed the production callback, PKCE exchange, authenticated `/user` identity check, fresh OAuth authentication method, same-account token refresh and local session logout. Organizational Microsoft accounts are supported by the registration, but an actual work/school fixture has not been tested. A company's consent policy may require its administrator to approve Vumiro. The successful personal-account check does not establish consent availability in every tenant.

The Microsoft real flow passed again after removing `User.Read`. The public login page was also checked after configuration loaded: both social buttons were enabled. Local screenshot evidence is retained in ignored `dist/social-login-setup/providers-live.jpg`.

#### Manual provider acceptance check

Run `node scripts/Test-OAuthProvider.mjs --provider google` or use `--provider azure` for Microsoft. Open the printed `AUTHORIZE_URL` in a browser and finish provider sign-in within five minutes. The script uses the production Electron OAuth callback/listener logic through the existing VM test seam, intercepting the external-browser launch so the operator controls which browser session is used. It requests production public configuration and performs real authorization-code/PKCE, identity, OAuth-authentication-method, refresh and local-logout checks.

Codes, PKCE verifiers and tokens stay in process memory; they are not printed or written. The script does not read a user's local profile or secure store, enroll devices, administer providers or delete identities. Its final logout applies to its own test session. For an offline fixture/listener check, append `--check`; that mode rejects an incorrect callback transaction, cancels the pending operation and confirms the callback port is released without contacting a provider.

This evidence covers the real hosted authorization flow and production Electron listener. It does **not** establish full installed Windows/Linux UI, secure-storage persistence, hardware behavior or cross-device restoration. Keep those acceptance items open until exercised separately. Provider cancellation, timeout, occupied port, sensitive-action wrong-account checks and organizational consent also require the appropriate separate acceptance cases.

#### Provider credential rotation

The current Microsoft client secret expires **2027-05-02**. Rotate it by **2027-04-02** to leave time for validation; the expiry date is an operating deadline, not an automatically scheduled reminder.

1. In the Entra application above, create a replacement client secret while the current one remains valid. Enter its one-time secret value directly into the Supabase Azure provider configuration and save; retain secret values only in approved encrypted credential storage.
2. Run the real Microsoft acceptance check and confirm live provider configuration and normal desktop sign-in. If the replacement fails, restore the still-valid previous credential and investigate before deleting it.
3. After successful validation, delete the old Entra credential, record the replacement's expiration and next rotation date here, and repeat the real flow after the old credential is removed.
4. If a Google client secret needs rotation, use the Google Auth Platform credentials for the registered web client, update Supabase Google provider configuration, validate the real flow, then retire the previous credential through Google's supported controls. Record any provider-specified expiry; no Google secret expiry was established during this setup.

Rotate immediately after suspected credential exposure. Never paste provider secrets into chat, logs, Git, client assets or the acceptance command line. Provider flag changes can pause one social option while preserving email/password and existing account access.

Provider setup references: [Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Microsoft](https://supabase.com/docs/guides/auth/social-sign-in/auth-azure), [redirect allowlists](https://supabase.com/docs/guides/auth/redirect-urls), and [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

## Release evidence

Before enabling accounts, retain evidence for:

- Automated backend validation and authorization tests.
- Windows and Linux package validation, including the update path from the current public release.
- Hosted signup, email verification, restart persistence, token refresh, recovery, password change, second-device restore, concurrent edits, device revocation, local/global sign-out, export, and deletion.
- Deletion-provider failure followed by automatic retry and eventual completion.
- JWT key rotation, unknown `kid`, expired/not-yet-valid token, invalid AMR, revoked device credential, malformed snapshot, request-size limit, CORS, and rate-limit behavior.
- Backup restoration into staging and confirmation that completed deletions are handled according to the documented backup-retention policy.
- Linux behavior with GNOME Keyring and KWallet, plus the fail-closed path when Electron reports plaintext storage.

## Data-subject requests

1. Accept requests only through the published channel. Never ask for a password, OTP, refresh token, device token, private key, or recovery secret.
2. Record the request date, requested right, identity-verification method, handler, actions, providers contacted, response date, and outcome.
3. Use proportionate identity verification. Do not collect more identity data than the account normally uses without a documented reason.
4. Account export must include the account email, synced snapshot, linked-device identifiers and activity/revocation state, sync revision/timestamps, and authoritative privacy-notice records held by Vumiro. Provider-held records require a documented provider request path.
5. Correction must cover both synced profile data and authentication email where applicable.
6. Deletion is complete only when Vumiro data and the authentication identity are deleted or a documented legal-retention exception applies. Pending provider deletion stays in the retry queue and generates an alert.
7. Explain separately how to erase local desktop data, because account deletion does not automatically delete an offline profile or device key.

## Security incidents

1. Start an incident record immediately. Preserve relevant evidence without copying secrets or unrelated personal data.
2. Contain access, rotate affected secrets, disable risky paths when necessary, and preserve existing-user export/deletion access when it is safe.
3. Identify affected systems, time window, data categories, number and type of data subjects, protections in place, likely harm, and mitigation.
4. The controller decides whether the incident can create relevant risk or damage. When notification is required, notify the ANPD and affected data subjects within the applicable three-business-day period. A preliminary notification must be completed within the permitted follow-up period.
5. Use clear, direct language for data-subject notices and include the affected data, protection measures, risks, mitigation, date learned, and contact channel.
6. Retain the incident record and decision evidence for at least five years, including incidents assessed as not reportable.
7. Run a post-incident review and track corrective actions to completion.

## Retention and recovery decisions

The operator must approve exact periods for unverified accounts, inactive accounts, revoked devices, completed deletion tombstones, pending deletion attempts, security logs, rights-request records, email-delivery logs, D1 recovery copies, Supabase records, and provider backups. Pending deletion records are operational work items and must not expire before completion.

Backups need access controls, restoration tests, a deletion-propagation process, and documented recovery objectives. A backup is not considered useful until a staging restore has succeeded and the restored data has been checked.

## Launch order

1. Finish code and automated tests.
2. Complete controller, lawful-basis, retention, provider, and transfer records.
3. Configure a staging provider and run the full hosted test matrix.
4. Configure production secrets, rate limits, email, monitoring, and alerts while registration remains disabled.
5. Deploy the Worker and release the compatible clients.
6. Verify existing-user sync, export, deletion, and rollback controls in production.
7. Enable new registration in a limited rollout, watch security and delivery metrics, then expand.
