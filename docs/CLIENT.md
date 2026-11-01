# Vumiro 1.20

Share your view. Local profiles, friends and direct screen/voice rooms in a small Windows app.

Download [Vumiro](https://github.com/snoopeh/Vumiro/releases/latest), extract **Vumiro-win-x64.zip**, and run **Vumiro.exe**. Windows 10/11 x64, .NET Framework 4.8 and Microsoft Edge WebView2 Runtime are required. No administrator access or local sharing server is needed.

Linux x64 packages are available in the same release: AppImage, deb and rpm. Follow the [Linux guide](LINUX.md). The Linux client shares rooms, profiles, friend requests and chat behavior with Windows, but uses a separate local device identity. Its screen picker and window frame follow the Linux desktop, and updates are downloaded for manual installation. Screen video and microphone are supported; system-audio loopback is unavailable in the Linux client.

Older 1.14/1.15 clients need one fresh installation after the repository/executable rename. The same Windows account keeps its local profile and friends. From 1.16 onward, use **Updates → Update now**.

## Your profile and friends

Create a display name, then open **Your profile** to choose an optional username and picture. Selecting or removing a picture saves it immediately. Display-name and username edits save with the profile form. Usernames are online lookup handles, not permanent cloud accounts; your identity belongs to the device key.

Choose **Add friend** and enter their username or short **vm1.** contact code. Vumiro fills the available public name automatically. Both people must be online for the initial lookup and request. With both clients on 1.19 or later, pending friend requests survive reconnects for up to 24 hours. An acceptance is saved until both apps have applied it, so the sender may reconnect later. The UI distinguishes service confirmation from delivery and reports failures. **Save code locally** supports offline/manual contact exchange. Both people must save each other or accept a request to become mutual friends.

The short code encodes your public key without changing your identity; existing long **stfriend1.** codes still work. A code contains no private key and cannot restore a lost profile. If no public name is available, an optional personal nickname remains a fallback. Personal nickname overrides stay in your contact book; your own profile display name is what others receive.

Online friends exchange current display names and pictures over direct, temporary peer connections and cache them locally. The Worker carries only the connection handshake. A restrictive network may prevent a fresh picture from arriving; cached pictures remain available. Room participants also exchange profiles automatically, and chat author names/pictures update when that profile arrives.

Removing or blocking a contact asks for confirmation first. Blocking removes their contact and prevents new social/profile exchanges. You can unblock identities in your profile settings.

## Rooms

Create a room and choose who may join:

- **Public:** anyone with the invitation can join after proving their local identity. The room is not listed in a global public directory.
- **Friends only:** mutual friends of the connected owner may join.
- **Private:** participants need the room password. Passwords stay out of invitation URLs and are not sent in plaintext to the Worker.

The owner can change access from inside the room. Signed policy changes update admission and remove participants who no longer qualify. Blocking remains effective in every mode. The owner must remain connected, and a room holds at most eight people. Existing older rooms retain their original owner-approval behavior until recreated with a current client.

Mutual friends see rooms under **Rooms → Friends' rooms**. Discovery refreshes on connection, room/presence changes, opening Rooms and reconnecting; it does not poll on a timer. Friends may request entry or use an invitation. Password rooms also require the password, even when the owner accepts a request.

The room uses a large focused stage with participant thumbnails, a **Chat/People** side pane and bottom call controls. Select a participant/stream to focus it. Double-click a stream for fullscreen. **Actual size** helps read small text. Screen, microphone and screen audio remain off until you enable them through the appropriate controls/picker.

Chat is live and direct P2P, with bounded local history while the room is open. There is no cloud message history or delivery to disconnected participants. **Reconnect** retries the room without discarding an existing usable capture; leaving the room or quitting Vumiro stops capture. Closing the window keeps the room connected in the system tray.

## Settings and updates

Open **Settings** outside the room or the room's **Stream settings**. FPS, resolution ceiling, bitrate per participant, text/motion preference and screen audio synchronize and persist on the device. Settings apply to active capture where the browser supports them. Screen audio must have been selected when capture started. Actual FPS depends on capture hardware, CPU and each peer connection.

The compact dark title bar supports dragging, double-click maximize/restore, window controls and edge resize.

Closing the window with **X** or **Alt+F4** hides Vumiro in the Windows system tray, including the hidden-icons area if Windows places it there. Your room, microphone, screen sharing and online connection keep running. Double-click the tray icon or right-click it and choose **Open Vumiro** to return. Choose **Quit Vumiro** from its tray menu to fully exit. The minimize button still minimizes to the taskbar. Updates and Windows shutdown can close the app normally.

Version 1.16.1 adds a subtle frosted window background on supported Windows systems. Text and streams keep their normal opacity. The effect follows Windows transparency and high-contrast settings; other systems retain the solid dark theme.

Version 1.17.0 adds picture panning and zoom before saving, participant profile popups with friend requests, clearer call icons, and a red startup spinner. Click the sidebar Vumiro logo or Friends to browse without disconnecting your room, then choose Return to room. The People list scrolls only when its contents exceed the available height.

**Updates → Update now** rechecks GitHub release metadata, verifies SHA-256, size and executable identities, then restarts through a separate helper. Leave the room before updating. Failed file copies roll back. Executables are unsigned; publisher-account integrity is the update trust anchor.

## Local data and connectivity

Profiles, nonextractable P-256 signing keys, friends, pictures, blocks and settings remain under `%LOCALAPPDATA%\ScreenTask\ClientBrowser`. That compatibility folder and the existing WebView origin deliberately keep their old internal names to preserve identities. Normal browsers use separate identities. Clearing that data loses the local key/contact book.

The Worker handles temporary online metadata, requests, room discovery and signaling. Friend requests store bounded public identities and signed proofs until answered/expired; completed outcomes remain for at most seven days or until both apps acknowledge them. Delivery and replay are pushed over the existing WebSocket, without polling. Expiry uses server time supplied during the existing handshake rather than requiring synchronized PC clocks. Media, messages and pictures remain direct P2P. There is no TURN relay; restrictive NAT/firewall combinations can prevent direct connections even when signaling succeeds. Participants receive peer network addresses and may record shared content.

Build/package: `./scripts/Build-Client.ps1`. The [restore guide](RESTORE.md) records the committed baseline and complete pre-cleanup backup. Runtime behavior in this iteration awaits your feedback; compilation/syntax checks are not an end-to-end security audit.
