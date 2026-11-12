# Linux account environment QA

Use branch `codex/linux-environment-recovery`. These changes keep session encryption and Chromium certificate verification enabled. They do not supply a keyring daemon or change the environment's certificate authorities.

## Get the QA app

Run **Build Vumiro** on this branch (or use its pull request checks). A successful run produces the **linux-qa-app** artifact containing `Vumiro-linux-qa.tar.gz`. Extract it, inspect `linux-unpacked/QA-SOURCE.json` for the source revision and QA marker, then run `linux-unpacked/vumiro` as your normal desktop user. These artifacts are unpublished QA builds and retain the current version number.

Use a disposable Linux user or isolated desktop session. The normal Linux app profile is `Vumiro-Linux` under Electron's application-data directory; installing a QA archive does not create a separate profile automatically. Do not copy production credentials into QA.

To build locally on Linux with Node 22 or later:

```sh
npm ci --prefix Vumiro.Linux
node scripts/Check-Client.mjs --group accounts --group linux --skip-backend
node scripts/Build-Linux.mjs --unpacked
xvfb-run -a node scripts/Test-LinuxSmoke.mjs
./dist/linux-release/linux-unpacked/vumiro
```

The offline smoke driver uses synthetic account transport and memory storage. A passing smoke run is not evidence of real keyring access, TLS trust, or connectivity between devices.

## Keyring and recovery

In a disposable profile, open the account page's developer console. `await window.vumiroDesktop.secureStore.status()` returns only `available`, an allowlisted `code`, and the selected `backend`. Do not print `secureStore.get()` results or share profile contents; they can contain credentials.

| Condition | Expected result |
| --- | --- |
| No session file and no usable keyring | A native `secureStore.get()` returns empty. Explicit status is unavailable and sign-in stays disabled with keyring instructions. No session file is created. |
| `gnome_libsecret` selected but Secret Service absent or locked | GNOME Keyring / Secret Service instructions appear. A libsecret client library alone is insufficient. |
| KWallet selected but unavailable | KWallet instructions appear. Initialize or unlock that wallet in the same desktop session. |
| `basic_text` backend | Protected storage stays unavailable. No plaintext fallback or credentials are written. |
| Encrypted session exists while storage is unavailable | Account readiness fails, the ciphertext stays unchanged, and Reconnect remains available. Compare a checksum without opening the file. |
| Explicit native deletion with unavailable storage | In the disposable profile, `await window.vumiroDesktop.secureStore.delete()` removes the session file without decrypting it. Repeated deletion succeeds. This deliberately signs out that profile. |
| Working keyring | Sign in with a test account, quit completely and restart. The encrypted session restores. Confirm the session file does not contain the test refresh token without printing it. |
| Storage recovers while network still fails | Reconnect rechecks both; the network error becomes visible and saved ciphertext remains intact. |
| Network recovers while storage still fails | Reconnect still reports the storage blocker and does not submit account credentials. |
| Both recover | Reconnect resumes the saved account without requiring a page restart. An invalid/revoked refresh token should instead allow a fresh sign-in. |

Electron selects and may cache the storage backend for the process. If a newly started keyring is not reflected by status, quit Vumiro completely and relaunch in the correctly initialized desktop session, then retry. Do not switch keyring backends for an existing encrypted profile without preserving its original ciphertext and encryption key.

## Chromium certificate and network checks

In the affected cloud runtime, obtain the intended interception CA only through the environment's trusted provisioning source. Have its administrator verify its identity and install it in the trust store used by that Chromium environment. A successful curl request alone does not prove Chromium trust. Do not bundle that CA into Vumiro or use certificate-ignore switches.

For account configuration and authentication requests, the app observes the existing Chromium transport result and returns a category: `NETWORK_CERTIFICATE`, `NETWORK_DNS`, `NETWORK_TIMEOUT`, `NETWORK_OFFLINE`, or `NETWORK_FAILED`. Observation does not retry a password/token request. Diagnostic state contains only allowed account origins, categories and short-lived timestamps; it does not log headers, bodies, tokens, query strings, certificate contents or raw errors. Storage remediation takes display priority when both dependencies fail, but every Reconnect checks both.

The opt-in TLS regression uses local HTTPS servers, ephemeral certificate authorities, and disposable NSS databases. Install `openssl`, NSS `certutil` (often `libnss3-tools`), the Electron runtime dependencies and Xvfb first. Run as a normal non-root user:

```sh
npm ci --prefix Vumiro.Linux
xvfb-run -a env VUMIRO_RUN_CHROMIUM_TLS=1 node --test tests/linux-chromium-tls.test.mjs
```

The test must accept a valid certificate signed by its explicitly provisioned test CA, reject an unknown CA, reject an expired certificate, and reject a wrong hostname. It never modifies the real user's trust stores. With opt-in enabled, missing prerequisites or failed trust checks fail the test. The ordinary cross-platform suite reports this runtime test as skipped.

In the actual cloud runtime, separately test its account endpoint with trusted versus untrusted provisioning, disconnected network, DNS failure and a connection timeout. The public service certificate is not proven defective by the original interception-CA error. Unknown or unexpected errors must still produce a safe generic message.

## Two devices

Once both environment checks pass, use two test identities on separate devices to sign in, connect, invite/accept a room, exchange a message, and test microphone and screen sharing. Confirm Reconnect does not create duplicate restore or room flows. Record the source revision, desktop/session type, selected backend, safe error codes and observed behavior; exclude account tokens, passwords and session files. Automated source checks do not establish human QA acceptance or authorize a production release.
