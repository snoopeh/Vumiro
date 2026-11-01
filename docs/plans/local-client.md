# Local friends client

Update 1.13.1: added direct room creation from the toolbar and Rooms menu, without a friend call or imported contact. Reuses on-device random room codes and the existing call iframe/invitation controls. Built with zero warnings/errors and deployed Worker version `ad15380e-f4cc-46bd-b200-5d1e2809072d`; desktop shortcut now selects `dist/client-1.13.1/ScreenTask/ScreenTask.Client.exe`. Existing local profile path is retained. Runtime testing remains with the user.

User decision: keep the existing Cloudflare handshake service; profiles, friends and media remain local or peer to peer. Continue implementation autonomously, reuse existing code, and leave runtime testing to the user.

Implementation: a separate .NET Framework 4.8 / WebView2 executable loads packaged friends and call pages from a trusted local HTTPS virtual origin. It starts no HTTP listener and includes no encoder/helper processes. Existing WebRTC capture, screen audio, microphone, simultaneous sharing and viewer controls are reused in a same-origin call iframe.

Local identity: nonextractable P-256 private CryptoKey persisted in IndexedDB; identity is SHA-256 of public SPKI. Public contact cards are exchanged manually and verified before adding to a local address book. Both parties import each other. Local nicknames and profile records are not cloud account records.

Coordination: a hibernating FriendDirectory Durable Object stores only live socket attachments. Challenge authentication proves identity ownership; invitations and answers are signed, expire and reference a pending nonce. Presence watches are bounded. Existing per-room CallRoom exchanges SDP/ICE only. No media relay, offline mailbox or global account registry is added.

Delivery: standalone small ZIP plus deployed Worker update; desktop shortcut selects the new client while preserving the legacy build. Build compilation and deploy output establish delivery only; performance and two-device call behavior remain unverified until user feedback. No test suites or end-to-end tests are run in this iteration, per the user's instruction.

Delivered 2026-11-01: `dist/client-1.13.0/ScreenTask-client-win-x64.zip` (312,366 bytes; packaged files 1,442,948 bytes, external WebView2/.NET Framework prerequisites). Release build completed with zero warnings/errors. Worker version `cf1e75e5-7689-44b0-8462-b11e63814cca` deployed successfully with both Durable Object bindings and five public assets. Desktop `ScreenTask.lnk` targets the new client; its previous target is preserved through `dist/client-1.13.0/ScreenTask-Legacy.lnk`. No application launch, runtime tests or benchmarks were performed for this iteration.
