# Vumiro account operations

This runbook records operating procedures and acceptance requirements for Vumiro accounts. Email/password alpha registration is live; [the launch record](../.planning/ACCOUNT-LAUNCH.md) distinguishes completed hosted checks from outstanding desktop, hardware and operational acceptance. Unchecked items here must not be reported as completed. This runbook does not replace legal review.

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
