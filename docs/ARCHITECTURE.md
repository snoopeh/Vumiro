# Vumiro architecture

## Active projects

- `Vumiro.Client`: .NET Framework 4.8/x64 WinForms host with WebView2, custom window chrome and a trusted update bridge. Produces `Vumiro.exe`.
- `Vumiro.Client.Updater`: separate replacement process sharing the package validator. Produces `Vumiro.Updater.exe`.
- `Vumiro.Linux`: isolated Electron host with a secure `vumiro://app` origin, native Linux frame, tray menu, explicit screen picker and restricted desktop bridge. Copies the existing six shared web assets at build time. Produces x64 AppImage, deb and rpm packages.
- `Vumiro.Client/WebServer`: local profile/contact storage, friends UI, direct profile exchange and WebRTC room UI. Exactly these assets are also published by `cloudflare/prepare-assets.mjs`.
- `cloudflare`: authenticated directory and per-room signaling Durable Objects. Bounded SQLite friend-request state supports reconnect replay; no account database, chat storage, avatar hosting or media relay.
- `scripts`: packaging, vector-icon generation and embedding of the locally licensed font.

## Identity and compatibility

The nonextractable P-256 private key stays in IndexedDB. A public identity is the SHA-256 fingerprint of its SPKI public key. The short `vm1.` code encodes the compressed public key; decoding reconstructs the same identity. Older `stfriend1.` codes remain valid.

The existing `https://screentask.local` WebView origin, `%LOCALAPPDATA%/ScreenTask/ClientBrowser`, IndexedDB database and legacy signed protocol domain strings remain intentional compatibility identifiers. Renaming those without a key migration would disconnect users from their identities. User-facing app/project/executable names are Vumiro. The public service is `vumiro-rooms.vumiro-signaling.workers.dev`; updated clients remap exact legacy hosts while preserving custom endpoints. Durable Object bindings still point directly to the original storage namespaces owned by the internal `screentask-rooms` script, with its original migrations in `wrangler.storage.jsonc`.

Linux uses a separate stable Electron user-data directory and the secure `vumiro://app` origin. A Linux installation creates its own device identity; it does not import the Windows nonextractable signing key. The service permits that exact local origin. The preload exposes only the existing window/update message interface, without Node.js access in either the friends page or room iframe.

Display names and pictures are public peer profile fields. A personal nickname override in one's contact book stays local. Online friends exchange fresh profile metadata over short-lived, authenticated, bounded WebRTC data channels; the Worker carries only the SDP/ICE handshake. Room chat resolves profiles by peer identity and updates when fresh metadata arrives.

## Rooms

Friend requests use the existing directory WebSocket for confirmed submission, delivery, acceptance and replay. SQLite rows belong to public identities rather than live socket attachments. A local IndexedDB transaction applies a contact and records its completed request nonce together, preventing replay from re-adding a contact removed later. There is no recurring fetch loop; storage changes occur on actions, reconnection replay and one-shot expiry alarms. Server timestamps in existing authentication handshakes anchor signed expiries independently of the Windows clock.

Each room binds its random invitation code to the owner identity. Every participant proves its local identity. Modern owner policy admits public participants, mutual friends, or participants proving knowledge of a password. Private-room passwords remain in local memory; PBKDF2-derived challenge responses go through signaling. Signed policy updates and current block/friend state govern ongoing access. The owner stays connected; rooms contain at most eight people.

Screen, voice and chat use direct mesh WebRTC connections. STUN helps find a route; there is no TURN fallback. Room discovery is event driven. Reconnect retains usable local room/capture state; leaving stops capture.

On Windows build 20348+, stream audio uses embedded WASAPI process loopback. Local output-session discovery selects application process trees while excluding Vumiro/WebView playback and optionally Discord. Bounded stereo float PCM passes through read-only WebView2 shared buffers to the trusted friends page, then to its current room iframe and a Web Audio MediaStreamDestination. One in-flight buffer plus the latest pending block bounds delivery; no local HTTP server or cloud audio endpoint is introduced. RTC screen audio and microphone occupy separate transceivers. Linux and unsupported hosts do not advertise the Windows native audio capability.

## Update trust and cleanup

Updates pin the Vumiro GitHub repository/release asset, require its SHA-256 digest and executable version, reject unlisted/archive traversal entries and linked paths, and use a separate helper with rollback. User data is outside the install directory and never included in the update allowlist. Publisher-account integrity remains the trust anchor; releases are unsigned.

The pre-cleanup restore tag and full offline backup preserve the retired native server, its dependencies, old build outputs and obsolete guides/harnesses. They are intentionally outside the active application tree. See [RESTORE.md](RESTORE.md).

## Validation policy

The user requested manual runtime feedback instead of automated runtime tests. This iteration uses compilation, JavaScript syntax checks, package inspection and source review. This does not claim a runtime/security audit.
