# Vumiro account operations

This runbook is the release gate and operating procedure for Vumiro accounts. It does not replace legal review. Account registration must remain disabled until every launch item has an owner and evidence.

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
4. Configure password policy, Auth rate limits, CAPTCHA or equivalent bot controls, session lifetime, refresh-token reuse detection, and account-enumeration-safe messages.
5. Put `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in encrypted Worker secrets. Never store the service-role key in the repository, desktop package, logs, or support tooling.
6. Configure Cloudflare rate limits for `/api/v1/account/*`, security-event logging, alerts, and an account-service dashboard. Logs must avoid tokens, passwords, OTPs, profile payloads, and device credentials.
7. Keep account service availability separate from new registration. Existing users must retain export, deletion, and sync access if registration is paused.

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
