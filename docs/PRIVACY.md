# Vumiro privacy notice for account sync

This notice describes the account-sync features being added for the Vumiro alpha. It is an implementation draft. The controller's legal identity and monitored contact channel, the lawful basis for each purpose, and Supabase's actual auth/email region are not configured yet. Account registration is disabled until the operator completes these items. Do not present this draft as a legal compliance certification.

## Data the account feature handles

| Data | Purpose | Storage |
| --- | --- | --- |
| Email address and password verifier | Registration, sign-in, email verification, and password recovery | Managed authentication provider; Vumiro never receives or stores the password after the auth request |
| Display name, online username, profile picture | Restore the profile across devices and show public peer profile fields | Vumiro account database; public profile fields are also sent to peers while online |
| Friend contact records (public key, display name, username, local nickname) and blocked identity codes | Restore the contact book and block list | Vumiro account database; contact data can identify other people. Friend pictures are not synced. |
| Stream preferences | Restore user-selected defaults | Vumiro account database |
| Account identifier, linked-device ID, first/last active timestamps, and a one-way hash of each device credential | Associate account data with its owner, restore sessions, and revoke lost devices | Vumiro account database; raw device credentials stay in operating-system secure storage |
| Rotating refresh token | Keep the user signed in after app restart | Encrypted with Windows DPAPI or Electron `safeStorage` on that device; access tokens remain in memory |
| Encrypted signing-identity recovery envelope and signed public-key transition | Restore the same contact identity on another device and let existing friends verify a one-time identity migration | Vumiro account database; the private key is encrypted client-side with AES-256-GCM, while the recovery code remains in operating-system secure storage and any offline copy the user saves |

Raw private signing keys, identity recovery codes, room passwords, screen/audio/video, chat, and microphone data are not included in account sync. The encrypted identity envelope contains only AES-GCM ciphertext and public recovery metadata. Other profile, contact, block, device, notice, and preference fields remain readable to authorized Vumiro infrastructure operators and the configured database provider. Cloudflare documents AES-256-GCM encryption at rest and TLS in transit for D1. [Cloudflare D1 security details](https://developers.cloudflare.com/d1/reference/data-security/)

## Account controls

The app provides sign-in, local and all-device sign-out, linked-device revocation, export, password recovery, password change, and account deletion. Users can correct profile information in the app. The account deletion endpoint removes the sync snapshot and requests deletion of the authentication identity. Local device profiles and signing keys remain on that device after account deletion; users can remove local app data separately. Export covers the account email, synced snapshot including encrypted identity ciphertext, device records, synchronization metadata, and privacy-notice acceptance records. Raw private keys, recovery codes, device credentials, refresh tokens, and local friend-request history are not part of the export.

Account data is retained while an account exists. Account deletion removes the account snapshot and linked-device records, and deletes the authentication identity through its admin API. A minimal account identifier tombstone expires after two hours to reject already-issued access tokens; failed identity deletion remains retryable while the tombstone is active. The hourly cleanup removes expired rows within the following hour. The authentication provider may retain limited security or operational records under its published retention rules. Vumiro must verify and disclose any provider-side backup, log, or legal-retention periods before public launch.

## Service providers and transfers

Authentication is designed for Supabase Auth. The Vumiro Worker and D1 account database are designed for Cloudflare. The D1 database is currently in Eastern North America (`ENAM`); Cloudflare does not offer a South America D1 location hint. The operator must record the chosen Supabase project region, provider/subprocessor terms, applicable international data-transfer mechanism, support contact, and incident channel here before enabling account registration. Email delivery is performed by the configured authentication provider.

## Requests and contact

Users can request confirmation, access/export, correction, deletion, portability, information about sharing, and other rights available under applicable law. The [ANPD rights guide](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares) summarizes these rights. The Vumiro project owner must publish a monitored privacy contact before account registration is enabled. No support email or private support channel is configured in this build; do not send passwords, recovery codes, or private keys in a support request.

## Security measures in this implementation

- Authentication and password verification are delegated to a managed auth provider.
- The Worker verifies signed access tokens using the provider's public signing keys, derives recent reauthentication from verified AMR timestamps, and applies a two-hour maximum token lifetime.
- Account snapshots use an isolated D1 binding and prepared statements, separate from signaling Durable Objects. Each linked device uses a random server-issued credential; D1 stores only its SHA-256 hash.
- Cloudflare documents AES-256-GCM encryption at rest and TLS in transit for D1; account snapshots are still visible to authorized service operators because they are not end-to-end encrypted.
- The API limits snapshot size and validates profile/contact fields; responses disable caching.
- Refresh tokens are persisted only through Windows DPAPI or Electron's OS-backed `safeStorage`; unsupported secure storage fails closed.
- Recoverable identity keys are encrypted in the client with AES-256-GCM under both a password-derived key and a random 256-bit recovery code. Decrypted keys are imported as nonextractable, signed legacy transitions are verified by the Worker and receiving friend, and raw keys and recovery codes are excluded from account exports and service logs.
- Password recovery is email-code based and should use a generic response to avoid account enumeration.
- Account deletion and export are available from the client UI.

This notice ships with the desktop package as `PRIVACY.md` (Windows) or `licenses/PRIVACY.md` (Linux). The shorter in-app notice is shown before account creation.

The implementation's baseline security review follows the [ANPD small-agent information-security guide](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/anonimizado___guia_orientat-_seg_da_inf_p_atpp.pdf). Review the ANPD guidance and the app's provider configuration before enabling registration.

## Before enabling registration

1. Configure the auth provider to require verified email, asymmetric JWT signing, password-recovery codes, and approved redirect/email templates. Set its storage/processing region and disclose it above.
2. Configure the Worker URL, publishable key, D1 database, and service-role secret. Keep the service-role secret only in Wrangler secrets, never in client assets or `wrangler.jsonc`. Set `ACCOUNT_REGISTRATION_ENABLED=true` only when the rest of this checklist is complete.
3. Confirm D1 and provider regions, backups, logs, deletion behavior, and data-transfer terms. Record actual retention periods and the controller's legal basis for each purpose.
4. Replace the support-contact placeholder with the controller's identity and a monitored privacy contact; publish a breach-response and rights-request process.
5. Review the notice and the implementation with Brazilian privacy counsel before general availability.

