# Vumiro alpha account privacy notice

Notice version: **2026-11-01**

**Emanuel Queiroz (snoopeh)** operates the Vumiro alpha account service. Contact **[snopeeh@gmail.com](mailto:snopeeh@gmail.com)** for privacy requests, questions, or security incidents. Never send a password, verification code, identity recovery code, private key, or device credential in a request.

An account is optional. You can use Vumiro with a local profile without account sync. If you choose an account, we process the information needed to register and authenticate you, verify or recover access by email, restore your selected data on another device, protect sessions and devices, and carry out export and deletion requests. The privacy checkbox records that you reviewed this notice; it is not permission for unrelated marketing.

## Information processed

| Information | Purpose and location |
| --- | --- |
| Email address, password verifier, authentication and session records | Supabase Auth handles registration, sign-in, verification and recovery. The app sends your password to Supabase for authentication; the Vumiro account backend does not store it. Brevo processes the recipient address and message content to deliver authentication and security emails. |
| Display name, online username and profile picture | Restore your profile through the Vumiro account database. These public profile fields are also shared with peers when you use the connection features. |
| Friends' public keys, display names, usernames and your local nicknames; blocked identity codes | Restore your contact book and block list through the account database. These records can identify other people. Friend pictures are not synced. |
| Stream preferences | Restore the defaults you selected. |
| Account identifier, linked-device identifiers, activity/revocation timestamps and device-credential hashes | Associate sync data with your account, protect sessions and revoke lost devices. Raw device credentials stay in secure storage on the device. |
| Sync revisions/timestamps and notice version/acknowledgement records | Resolve sync changes and record which notice you reviewed. |
| Encrypted signing-identity recovery envelope and signed public-key transition | Restore the same contact identity on another device and let friends verify an identity migration. The private signing key is encrypted in the app with AES-256-GCM before upload; the service stores ciphertext and public recovery metadata. |
| Rate-limit windows, deletion-job status and service logs | Limit abuse, diagnose failures and finish account deletion. Providers also process technical information such as IP addresses and request metadata to operate and secure their services. |

Screens, audio/video, chat, microphone data and room passwords are not part of account sync. Raw private signing keys and identity recovery codes are not uploaded to the account service. Your recovery code remains in operating-system secure storage and any offline copy you save. Refresh tokens are saved through Windows DPAPI or Electron's operating-system-backed `safeStorage`; access tokens remain in memory.

The signing-identity backup is encrypted in the app. Other synced profile, contact, block, device, preference and notice fields are **readable by authorized Vumiro infrastructure operators and the database provider**. They are not end-to-end encrypted. Encryption during transport and at rest does not change that access.

Google or Microsoft sign-in, when enabled and chosen by you, shares your email and basic profile for authentication. Vumiro does not request your mailbox, files or address book for this sign-in.

## Your controls and requests

Account settings provide profile correction, account export, password recovery/change, local or all-device sign-out, linked-device revocation and account deletion. Export includes the account email, synced snapshot (including encrypted identity ciphertext), linked devices, sync metadata and notice acknowledgement records. It excludes raw private keys, recovery codes, credentials, refresh tokens and local friend-request history.

You can also contact [snopeeh@gmail.com](mailto:snopeeh@gmail.com) to request confirmation of processing, access, correction, deletion, portability, information about sharing or other rights available under applicable law. We may need proportionate information to verify that the request concerns your account. The [ANPD's rights guide](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares) explains data-subject rights. Provider-held records may require assistance from the relevant provider.

Deleting an account removes the synced snapshot, linked devices, notice records and account rate-limit rows from the active Vumiro account database and requests deletion of the Supabase authentication identity. If the provider request fails, the app reports that identity deletion is pending. A minimal deletion job retains the account identifier, status, attempt timestamps/count and error category; it remains pending **until provider deletion succeeds**, with automatic retries. It does not expire after two hours. Once completed, its token-blocking record expires after **two hours** and is removed by hourly cleanup, normally within the following hour. Service outages can delay maintenance.

Account deletion does not erase an offline device's local profile, contacts or signing keys. Remove local app data separately if you want to erase those copies. Deleting active database rows also does not immediately remove provider logs or recovery copies described below.

## Retention

Synced account data remains while the account exists; no automatic inactive-account deletion period is implemented. Revoked-device records are eligible for cleanup after **90 days**, and account rate-limit windows after **two days**. Hourly maintenance removes eligible rows; account deletion also removes that account's device and rate-limit rows. Pending deletion jobs and completed deletion records follow the separate process above.

Cloudflare D1's always-on Time Travel recovery history covers the preceding **seven days** on the Free plan. Deleted data can therefore remain in recovery history during that period. [D1 backups](https://developers.cloudflare.com/d1/reference/time-travel/)

Cloudflare Workers Logs on the current Free plan have **three-day retention**. The Vumiro Worker configuration disables invocation logging and tracing and redacts URL queries. This does not disable all Cloudflare operational/security processing. [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)

Supabase Free lists **one day of API/database log access** and **one hour of Auth Audit Logs**. These dashboard access periods do not establish deletion deadlines for every provider-held security, telemetry or billing record. Optional Auth audit records written into the project database are separate from external logs. We do not have a verified retention deadline for every Supabase internal record. Supabase does not provide a guaranteed daily-backup offering for this Free project; its documentation recommends manual exports for Free users. [Pricing](https://supabase.com/pricing), [log-access explanation](https://supabase.com/kb/troubleshooting/check-usage-for-monthly-active-users-mau-MwZaBs), [Auth audit storage](https://supabase.com/docs/guides/auth/audit-logs), [backups](https://supabase.com/docs/guides/platform/backups)

Brevo is configured to keep **one month of transactional logs** for all senders and to **Never store previews** for new email content. Preview settings do not remove any previews already stored before the setting applied; existing logs/previews may require deletion separately. Scheduled log deletion can take up to 24 additional hours, and individual manual log deletions up to 72 hours. These controls do not establish a deletion deadline for every delivery queue, backup or internal security record. [Retention controls](https://help.brevo.com/hc/en-us/articles/4415743225746-Configure-a-custom-retention-period-for-your-transactional-logs-and-email-previews), [transactional logs](https://help.brevo.com/hc/en-us/articles/360021533839-Manage-your-transactional-logs-and-email-previews)

Brevo is configured for anonymous email tracking: opens and clicks are not associated with specific contacts. This still permits aggregate measurement and does not remove all tracking pixels from Free SMTP emails. Vumiro's code-only authentication templates contain no action links or images of their own; Brevo can still add its own processing. [Tracking controls](https://help.brevo.com/hc/en-us/articles/11643306229906-Can-I-anonymize-the-tracking-of-opens-and-clicks-for-my-emails), [pixel-removal limitation](https://developers.brevo.com/changelog?rl_entry=184d74014eef)

## Providers and processing outside Brazil

| Provider | Role and locations |
| --- | --- |
| Supabase | Authentication. This project's Auth service and database are hosted in AWS **São Paulo, Brazil (`sa-east-1`)**. Supabase also processes logs in EU data centers and can process support/operations information outside the selected region, including Singapore and the United States. |
| Cloudflare | Worker API and D1 account storage. The current D1 location is **Eastern North America (`ENAM`)**. This is a location designation/hint, not a guarantee that all processing is confined to one country. Workers and supporting network/security services can process requests internationally. |
| Brevo | Transactional authentication/security email via encrypted SMTP. Brevo describes EU database hosting in **France, Germany and Belgium**, with replicated copies and encrypted backups. That description does not establish that every support or subprocessor operation stays in those countries. |

Supabase's regional hosting does not mean all account processing remains in Brazil, and Cloudflare does not offer a South America D1 location hint. Brevo replaces the Gmail sender domain for delivery: tested account email uses the display name Vumiro and sender `snopeeh@12660220.brevosend.com`. Vumiro's contact address remains [snopeeh@gmail.com](mailto:snopeeh@gmail.com). [Supabase locations/transfers](https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq), [D1 locations](https://developers.cloudflare.com/d1/configuration/data-location/), [Brevo locations/backups](https://help.brevo.com/hc/en-us/articles/360001005510-Data-storage-location), [Brevo sender rewriting](https://help.brevo.com/hc/en-us/articles/16045394674066-Troubleshooting-Domain-authentication)

The providers publish processing terms and subprocessor/transfer information: [Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum), [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/), and [Brevo DPA information](https://help.brevo.com/hc/en-us/articles/15403782599570-Where-can-I-find-the-Data-Processing-Agreement-DPA) / [Terms of Service](https://www.brevo.com/legal/termsofuse/). Contact the operator for questions about provider contracts, safeguards and processing outside Brazil.

## Security and further information

The alpha uses verified-email authentication, a minimum 12-character password, six-digit email codes expiring after 600 seconds, and ES256 access tokens configured for 3,600 seconds. Password-change and email-change security notifications are enabled. The Worker validates token signatures, ownership and linked-device credentials; it stores device-credential hashes rather than raw credentials. Identity recovery encryption protects the private-key backup; other account fields retain the operator/provider visibility explained above. These measures reduce risk but do not guarantee that incidents cannot occur.

This notice ships as `PRIVACY.md` on Windows or `licenses/PRIVACY.md` on Linux. The app shows a shorter notice before account creation. Operator procedures, provider configuration evidence and incident/request handling are maintained in [Account operations](ACCOUNT-OPERATIONS.md).
