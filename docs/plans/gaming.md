# Built-in gaming implementation

## Goal

Gaming is a main-menu destination with LAN tunneling, Game together and Controller mappings. Vumiro supplies the transport and user flows. No external tunneling or streaming application, account, pairing flow or manual component download is required. The initial provider-integration design was rejected and replaced; its history remains in Git.

## Architecture and boundaries

- Existing P-256 friend identities sign invitations and every negotiation message. Both clients and the existing friend directory enforce expiry, replay protection and mutual unblocked friendship. An invitation requires explicit acceptance before native resources start.
- Vumiro's WebRTC data channels carry original IPv4 packets. A host and up to three guests receive a reserved /24. Vumiro owns address assignment, unicast forwarding, broadcast/multicast replication, source validation and bounded queues. The signed Wintun component provides only the Windows layer-3 device interface.
- Vumiro captures a selected window/screen and available audio, then streams through WebRTC. Focused guest keyboard mapping or a physical standard gamepad supplies input. A host-side virtual Xbox device exposes that input to Steam/games. A game must support local multiplayer and assign the extra controller a player slot.
- The controller diagram uses the app theme and exposes all 24 mapped controls. Profiles are local, bounded and validated; import/export uses JSON. Ordinary navigation/text input remains available. Escape, blur and stale input neutralize controls; session termination removes native devices.
- The existing updater executable also hosts the elevated, PID-authenticated and bounded gaming IPC service. Signed Wintun and ViGEmBus binaries ship embedded in both existing executables with pinned hashes and license notices. Windows authorization and an occasional driver-install reboot remain OS requirements. No driver/application code is represented as original Vumiro protocol work.
- No default internet route is replaced. IPv6-only, raw Ethernet and IPX games are outside this IPv4 implementation. Windows Firewall rules for individual games still apply.

## Delivery

Implementation was isolated on `codex/gaming`, then merged file by file into the original checkout. Shared navigation, direct-message hooks, workspace gates and packaging lists preserve concurrent changes. Before integration, all 289 files outside the gaming diff were hashed; every one remained unchanged. Originals are backed up under `dist/builtin-gaming-integration/before`. The original checkout's unrelated work was never staged or reset.

Integration adapted the other agent's existing navigation tests to the new gaming fixture and taught its backend test loader to resolve the added gaming module. Their behavior assertions and implementations remain intact.

## Verification and limits

- Combined checkout: 741 client tests, 98 backend tests and all twelve native check groups passed in fresh runs. Reports are under `dist/checks/builtin-gaming-merged-final` and `dist/checks/builtin-gaming-merged-native`; the standalone backend rerun is `npm test` in `cloudflare`.
- Both Windows package schemas built and passed package consistency validation in the isolated checkout. The driver payloads remain embedded without changing the frozen updater file sets.
- A real LOCAL QA WebView2 loopback decoded synthetic video/audio, delivered controller input and neutral release, and routed two-guest LAN unicast/broadcast while rejecting source spoofing. Native calls were intercepted in that transport test. A separate integration check created a real virtual Xbox device, submitted input and removed it.
- The merged native app rendered all three screens, exposed all 24 diagram controls, had no horizontal overflow and reported both device components bundled. Readiness checks did not invoke UAC or install anything.
- Real two-PC/game/Steam latency and the elevated Wintun adapter path still require human QA. Client and signaling changes must ship together. No operator TURN endpoint has been provisioned; restrictive NATs can fail until relay infrastructure is supplied through validated ICE configuration.
- No version bump, source push, release tag, publication or production deployment was performed. Automated evidence is not human acceptance.

The user authorized autonomous implementation, isolation and merge; generic workflow approval pauses do not apply.
