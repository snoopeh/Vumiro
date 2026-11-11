# Built-in gaming

Gaming contains **LAN tunneling**, **Game together** and **Controller mappings**. Windows users use Vumiro alone. It does not require a ZeroTier account, an external streaming application or a separate controller-mapping utility. The required signed network/controller device components ship inside the app and its existing updater helper. First use can require the normal Windows UAC authorization; a controller driver installation can require a reboot.

## LAN tunneling

Choose an online saved friend and invite them. The friend explicitly accepts, then Vumiro creates a private IPv4 gaming network. The host can invite up to three guests. Each member receives a 10.203.x.x address in the same /24. Games may use their normal LAN discovery broadcasts, or join the host's virtual address directly. LAN stays connected while browsing other app screens; **Leave session** ends it.

Vumiro owns the invitation protocol, signed session admission, WebRTC packet channels, address assignment, host forwarding and packet validation. It uses Wintun solely as the signed Windows network-adapter interface. Only accepted peers' assigned source addresses may enter the adapter. Unicast routing, broadcast/multicast replication, spoof rejection, bounded queues and disconnect cleanup are implemented here. The normal default internet route is not replaced; IPv6-only and raw Ethernet/IPX games are outside this IPv4 implementation.

## Game together

Invite one friend and wait for acceptance, then **Share game** to choose the game window or screen through Windows' capture picker. Vumiro sends video and available captured audio through WebRTC. Choose 30/60 FPS and a bitrate target; actual quality depends on the encoder and connection. System audio availability depends on the chosen capture source and WebView2/Windows. Audio and video share one playback stream. Use **Enable game audio** if browser autoplay permission is needed.

On the guest PC, click the game picture to send input. Escape, moving focus away or leaving the picture releases all controls. A physical controller uses the browser's standard gamepad mapping; keyboard mode applies the chosen Vumiro mapping. The host creates a virtual Xbox controller for the accepted guest. Choose a game with local multiplayer and assign that controller a separate player slot; Steam and games enumerate it like another local controller. Idle input is neutralized after 300ms without removing the player's controller; session end, permission revocation, full page navigation and app close remove it.

## Controller mappings

The interactive controller diagram exposes both sticks, stick clicks, triggers, shoulders, D-pad, face buttons and Start/Back. WASD defaults to the left stick and arrows to the right stick. Click a control and press a key to rebind it. Keys are unique, opposite directions cancel and diagonals stay inside the analog radius. Digital keys produce full-scale analog values; they cannot supply physical pressure sensitivity.

Save up to 20 local profiles, import/export bounded JSON, and **Apply to game**. The guest requires no virtual-device driver; the controller exists on the host. Choosing a physical controller bypasses keyboard conversion.

## Safety and delivery

Saved P-256 identity keys authenticate each signaling message, including SDP, ICE and LAN assignments. Invitations expire; replayed messages are rejected. Only mutual unblocked friends can negotiate. A received invitation creates no native adapter or input device until accepted. Removing a friend or changing its trusted key revokes its existing access; one LAN guest leaving does not disconnect the others.

Windows signed device components are bundled with pinned hashes, vendor signatures and their required license notices. This includes the retired ViGEmBus compatibility backend; its driver code is attributed, not represented as original Vumiro work. Vumiro's original application/protocol code uses only the documented driver interfaces. No external program download or third-party account setup occurs during gaming.

The client and server changes must be shipped together: the existing friend service needs the new authenticated gaming relay branch. A Vumiro-operated TURN service can be supplied through the engine's validated ICE configuration for restrictive NATs. No TURN endpoint has been provisioned by this change; direct internet connections may fail on restrictive networks until that operator infrastructure is configured. This is an operator deployment requirement, not a client installation task.

## Verification

Run `node scripts/Check-Client.mjs --group gaming --native`. This runs the gaming JS checks, backend regressions and five native gaming groups. `tests/GamingControllerChecks/.../GamingControllerChecks.exe --integration` creates a real neutral Xbox device and tests input/cleanup when its driver is installed. `node tests/gaming-webrtc-loopback.mjs http://127.0.0.1:9230` uses a LOCAL QA WebView2 debugger for real RTC video/audio, signed signaling, controller messages and two-guest LAN routing; media is synthetic and native calls are intercepted.

Real two-PC/game/Steam latency and the elevated adapter path remain explicit human QA. Source checks and loopback success do not constitute release acceptance. See GAMING-RUNTIME.md, GAMING-LAN.md and GAMING-SESSION.md for implementation boundaries.
