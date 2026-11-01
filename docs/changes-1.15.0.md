# Vumiro 1.15.0

The local client is now **Vumiro**, with the supplied red/black identity, ribbon-V icon, Sora typography and compact custom window frame. Existing profiles, contacts and updates stay compatible.

- **Friend requests:** find an online username or paste a contact code; names fill automatically. Accept, decline or block. Explicit offline contact-code import remains available.
- **Friends' rooms:** event-driven room notifications and a Rooms submenu, without polling. Request entry; the owner approves with a signed identity-bound grant.
- **Room chat:** bounded live chat sent directly through WebRTC, without a Worker relay or cloud history.
- **Pictures:** choose a local image, compress it locally, and exchange through a peer connection. Friends cache pictures after connecting.
- **Stream controls:** FPS, resolution, bitrate, detail/motion and screen audio inside and outside rooms, synchronized and applied live where supported.
- **Connection/window controls:** reconnect buttons, double-click stream fullscreen, native dragging/resizing/maximize, and no white Windows title bar.

Download **Vumiro-win-x64.zip**, extract, and run **ScreenTask.Client.exe**. Existing 1.14 users can use **Updates → Update now**. ScreenTask-client-win-x64.zip contains the identical files for updater compatibility.

Usernames are online lookup handles; contact codes are the fallback. Requests have no offline cloud mailbox. Pictures update after a P2P connection. Guests need the latest client and owner approval; create/request fresh rooms after updating. Direct connections can fail on restrictive networks because no media relay is configured.

Requires Windows 10/11 x64, .NET Framework 4.8 and Microsoft Edge WebView2 Runtime. Runtime tests/app launch are deferred to the user. Compilation, syntax checks, integration review and publishing results are recorded separately; no security audit or performance guarantee is claimed.
