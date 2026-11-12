# Account environment recovery implementation plan

**Goal:** Make Linux keyring and Chromium transport failures actionable while retaining encrypted sessions and certificate verification, for remote QA.

**Design:** Keep the existing protected session file and trusted account frame boundary. A focused storage module returns structured, allowlisted results; the preload bridge preserves codes. Missing files and validated deletion do not require a keyring. Reads of existing ciphertext and all persistence require protected storage. A passive native transport observer reports only categorized outcomes for allowed account endpoints. It never retries credentials, modifies trust, or logs request details. Account startup and Reconnect independently recheck storage and service availability, then safely resume saved credentials. Existing Windows storage remains compatible. Localized messages use codes first and retain a generic unknown-error fallback.

**Tech stack:** Electron 45, Node test runner, shared browser JavaScript and six existing locale catalogs.

## Storage (isolated worker)

- [x] Add failing temp-file and IPC tests in `tests/linux-secure-store.test.mjs`: missing file, unavailable/locked/unprotected backend, validated deletion, failed decrypt/write preservation, encrypted restart, sender rejection.
- [x] Extract `Vumiro.Linux/secure-store.cjs`; wire `main.cjs` handler, `preload.js` status/result unwrapping, and packaged file list.
- [x] Run `node --test tests/linux-secure-store.test.mjs` and confirm green after red.

## Account recovery (isolated worker)

- [x] Extend `tests/account-client.test.mjs` with failing status, independent recovery, retry/restore, and sanitized network cases.
- [x] Update `account-client.js` readiness and retry without removing session files on transient failures; preserve Windows compatibility.
- [x] Run `node --test tests/account-client.test.mjs` and confirm green after red.

## Diagnostics and integration (Machine Spirit)

- [x] Add failing transport categorization, trusted caller, bounded retention and code localization tests.
- [x] Implement `Vumiro.Linux/network-diagnostics.cjs` using passive webRequest outcomes; expose a validated IPC/preload check and package it.
- [x] Add six-language actionable storage/backend and certificate/DNS/timeout/offline messages in `i18n.js`.
- [x] Update offline smoke fixture for the storage result envelope and explicit synthetic status, keeping its limits clear.
- [x] Run focused Linux/account/localization checks, followed by the full client check once the integrated source settles. Read compact reports and investigate named failures.
- [x] Review the integrated diff and add a remote Linux QA guide covering real keyring restart, locked ciphertext preservation, separate recovery, trusted/unknown/expired/wrong-host TLS, and two-device testing.

**Acceptance boundary:** Automated tests can verify filesystem behavior and categorized contracts with injected backends. This Windows host cannot establish a working Linux keyring, cloud Chromium trust, or two-device connectivity. No version bump, production deployment, certificate override, plaintext fallback, or changes to other worktrees are included.
