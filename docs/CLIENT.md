# Vumiro 1.22.2

Share your view. Local profiles, friends and direct screen/voice rooms in a small Windows app.

Version 1.22.2 adds sender notifications that open their source, a consistent settings menu with unsaved-change confirmation, six accessible interface languages, named friend tags, signed friend nudges, room loading feedback, login motion, stream mosaics and message replies. Chat has a larger resizable pane, a shorter fading thumb and no timed text cooldown. Sign-in is required; successful sign-in opens the lobby after any necessary encrypted-identity recovery. Local profiles and signing identities remain stored on the device.

Download [Vumiro](https://github.com/snoopeh/Vumiro/releases/latest), extract **Vumiro-win-x64-v2.zip**, and run **Vumiro.exe**. Windows 10/11 x64, .NET Framework 4.8 and Microsoft Edge WebView2 Runtime are required. No administrator access or local sharing server is needed. The **Vumiro-win-x64.zip** asset is a compatibility bridge for older automatic updaters; after installing it, use Update now again to finish installing the complete package.

Linux x64 packages are available in the same release: AppImage, deb and rpm. Follow the [Linux guide](LINUX.md). The Linux client shares rooms, profiles, friend requests and chat behavior with Windows, but uses a separate local device identity. Its screen picker and window frame follow the Linux desktop, and updates are downloaded for manual installation. Screen video and microphone are supported; system-audio loopback is unavailable in the Linux client.

Older 1.14/1.15 clients need one fresh installation after the repository/executable rename. The same Windows account keeps its local profile and friends. From 1.16 onward, use **Updates → Update now**. In1.21.8, Updates lives in the bottom profile menu.

Version 1.21.1 moves the connection service to **https://vumiro-rooms.vumiro-signaling.workers.dev**. Both peers should update for the new address. Known legacy saved URLs and invitations migrate automatically; custom services and local identity data are preserved. GitHub updates remain available even when an older client cannot reach the retired service hostname.

Version 1.21.2 fixes a Windows startup rendering issue that could leave the loading spinner visible over the loaded interface.

Version 1.21.3 introduced the Vumiro account client, secure persistent sessions, friend/profile backup, linked-device controls, export and deletion, password recovery, and encrypted contact-identity recovery. Its initial release kept registration gated during provider setup.

Version 1.21.4 makes invitation links visible and selectable, adds separate screen/voice volume sliders inside each received stream, includes the updater helper in development builds, and uses conventional Windows caption controls without an inactive gray frame. Dedicated Sign in, Create account, Verify email, and Password recovery screens are available from Account and first-run setup.

Version 1.21.5 refreshes the app from the supplied visual concepts: a scenic red login background, warm glass account card, refined sign-in controls with password visibility, and a clean call workspace with organized actions, larger dock controls and a **Watch Together** navigation item. Small windows keep the call controls visible. The background is bundled with the app and needs no image download.

Version 1.21.6 prevents duplicate Windows app instances, including a copy hidden in the tray. Opening Vumiro again restores the existing window. Updates check for other copies from the same installation before downloading and after shutdown, prepare backups before replacing files, skip unchanged files and preserve the failing filename/cause in an update log under `%LOCALAPPDATA%\Vumiro\Updates`. On older versions, choose **Quit Vumiro** from its tray menu before retrying a blocked update; closing its window hides it in the tray.

Version1.21.8 streamlines the sidebar: Friends and Rooms stay prominent, and the bottom profile menu groups profile editing, Account & backup, Voice & audio, Settings and Updates. Signed-in accounts have an explicit **Sign out of account** action. Account mode and service connection status are separate. Ordinary sign-out clears the saved account session and stops sync while keeping your local profile, contacts and active room. All-device sign-out and device revocation remain explicit security actions in Account & backup.

## Your profile and friends

Create a display name, then open the bottom **Profile and account** menu and choose **Edit profile** to set an optional username and picture. Picture, cover, name, username, bio and link edits stay as drafts until **Save profile**. Dismissing the editor discards those changes. Rejected images and successful saves show toast feedback. Usernames remain public lookup names for device identities.

## Vumiro account

Version 1.21.7 connects email/password accounts to the hosted service and publishes the operator and provider details in the privacy notice. Signing-key rotation no longer rejects valid cached sessions, and pending identity deletion is reported accurately.

The dedicated welcome page opens when signed out. It offers configured **Google**, **Microsoft**, and Vumiro **email/password** sign-in, plus **Create account**, email verification, and password recovery. An account is required before entering the lobby or a room. Existing local profile data remains on the device. Account management is inside the common settings menu. Social sign-in opens the system browser and requests only email and basic profile details; Vumiro does not request your mail, contacts, or files.

Email/password sign-in and verified-email registration are enabled. Use at least 12 characters for your password and enter the six-digit confirmation code from your email; codes expire after ten minutes. Social providers appear when enabled by the service configuration. A signed-in device keeps its session after restarts using Windows DPAPI or the Linux desktop keyring. Linux account sign-in is unavailable when no secure keyring is configured. Social users can set a separate Vumiro backup password for encrypted contact-identity recovery on another device when those providers are enabled.

The account can back up and restore the profile, friend contact book, blocks, stream preferences, and client-encrypted signing identity. Save the identity recovery code offline when enabling backup. Existing nonextractable local identities require a one-time signed migration; updated friends verify it when both peers are online, while older clients may require a new friend acceptance. Choose which direction to sync when both this device and the account already have data. Concurrent edits use a revision check; automatic sync pauses on conflict. **Export my data**, linked-device revocation, sign-out, and account deletion are in the same panel. Deleting the account removes synced account data; it leaves the local device profile and signing key on the device.

The [privacy notice](PRIVACY.md) describes synced fields, the operator contact, service providers, and infrastructure locations. The signing-identity envelope is encrypted in the client; other account snapshot fields are not end-to-end encrypted. Verification and recovery emails display Vumiro; the current email provider rewrites the sender to its authenticated `brevosend.com` domain. Check your spam folder if a code is missing. Initial email limits are 30 messages per hour at Supabase and 300 per day at Brevo.

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

Choose **Invite** to send an invitation directly to an online friend, copy a short room link, or share an eight-character room code. Short links carry only an opaque token and codes expire after 24 hours or when the owner closes/changes the room. Passwords and identity-bound admission proofs stay outside both. The updated service is required; older standalone room clients retain selectable legacy links. Use Public or Private when inviting people who are not mutual friends; share a private room's password separately. Each received stream has independent **Screen** and **Voice** playback sliders, including in fullscreen. Set a slider to zero to mute that track.

Mutual friends see rooms under **Rooms → Friends' rooms**. Discovery refreshes on connection, room/presence changes, opening Rooms and reconnecting; it does not poll on a timer. Friends may request entry or use an invitation. Password rooms also require the password, even when the owner accepts a request.

The room uses a large focused stage with participant thumbnails, a **Chat/People** side pane and bottom call controls. Select a participant/stream to focus it. Double-click a stream for fullscreen. **Actual size** helps read small text. Screen, microphone and screen audio remain off until you enable them through the appropriate controls/picker.

Chat is live and direct P2P, with bounded local history while the room is open. There is no cloud message history or delivery to disconnected participants. **Reconnect** retries the room without discarding an existing usable capture; leaving the room or quitting Vumiro stops capture. Closing the window keeps the room connected in the system tray.

### Room chat and files

You can write and send messages while alone in a joined room or while its connection recovers. Updated clients synchronize up to 100 signed text messages from the current room, less than 24 hours old, when someone connects. History stays in memory and clears when you leave or switch rooms. At least one participant retaining the history must remain; the service does not store chat. Older clients receive live text but do not provide authenticated history.

The toolbar supports **bold**, *italic*, inline code and safe HTTPS links. The emoji button opens an offline searchable picker with categories and recent choices. Enter sends; Shift+Enter adds a line break. Text remains limited to 2,000 characters.

Use the **paperclip**, paste an image, or drop a file into the composer (up to 10 MiB per file). You can stage files while alone; they are offered when participants connect while you remain in the room. Recipients choose **Receive**, then **Download**; PNG/JPEG/WebP/GIF files also show a preview, preserving GIF animation. Up to three outgoing files and 20 MiB of local/received files are retained in memory; leaving clears them. Transfer needs a working direct connection. HTTPS links show hostname/path cards; direct image/GIF links and YouTube links offer an explicit **Load preview** button. External images never load automatically. Generic website metadata/OpenGraph thumbnails are not fetched.

### Named friend tags

On the updated directory, a public handle combines a username and a code, for example `mira#48271`. People can share a username; random five-digit codes identify the exact person. Existing three-digit named codes migrate once on the updated service; numeric legacy tags remain valid. Search `@mira` to choose from matching online users or enter `mira#48271` for an exact match. Copying a tag uses this combined handle. Existing numeric tags and contact codes remain compatible. A username change can change the combined handle; the signing identity stays the same.

The updated directory service was deployed with the 1.22.2 rollout. It assigns named tags to updated clients; legacy clients retain compatibility with their numeric identifiers. The live LOCAL QA reconnect verified a directory-issued named tag.

### Voice & audio

Open **Voice & audio** from the profile menu before joining, or from the call controls. Choose your microphone and speaker/headphones, adjust master playback, and enable supported echo cancellation, noise suppression and automatic microphone level. These hardware preferences stay on this device and do not join account sync. Each participant has independent **Screen** and **Voice** sliders from 0% to 400%, combined with master playback volume. 100% preserves the original level; higher settings amplify quiet audio and can distort loud sources. Boost keeps your selected speaker and deafen settings. If the audio engine cannot amplify, playback continues at up to 100% with an explanation.

Opening the panel does not start capture. **Enable mic meter** explicitly starts a local input-level check; **Record & play test** records a short local sample and plays it through the selected speaker. During that recording/replay, outgoing room microphone and incoming room playback pause. Stop or close the panel to release test tracks and restore the previous room state. **Test speaker** plays a short tone without enabling the microphone. If output selection is unavailable, use your operating-system sound settings.

**Deafen** silences received room audio and temporarily suppresses your outgoing microphone. Undeafen restores your previous mute and per-person volume choices. Microphone mute and screen sharing remain separate. Processing availability depends on the browser/audio engine; current track settings are shown when available. This release does not add system-wide push-to-talk or a hardware microphone-gain control.

### Stream audio on Windows

Turn on **Include screen audio** to share application sound alongside your screen. On supported Windows versions (build 20348 and newer, including Windows 11), Vumiro captures audio natively instead of depending on the screen picker's optional audio track. **Exclude Discord from stream audio** defaults on: you still hear the Discord desktop app locally, but viewers do not hear its voices repeated through your stream. Vumiro's own playback is excluded to avoid feeding room audio back to participants. These settings do not mute your microphone.

You can switch stream audio or Discord exclusion while sharing. Stopping your share or leaving the room stops the native capture. The Discord exclusion setting stays visible on unsupported devices, disabled with an explanation: it requires Windows build 20348 or newer. Older Windows versions use the browser picker's available audio option, which cannot filter Discord. Linux system-audio capture remains unavailable in this release.

If an application's audio device becomes unavailable, native capture retries that source while the other application audio continues. A warning includes the process and Windows error code. A fatal audio failure stops system audio while leaving screen video and microphone available. Audio graphs use the output device's default sample rate. Hardware-specific browser or driver crashes may still need investigation on the affected device.

### Exporting stream diagnostics

After a failed share, open **Updates → Stream diagnostics → Export diagnostic logs**. Windows saves a ZIP with up to 24 hours of technical events and the previous session's completion status, including app/Windows/WebView versions, capture configuration, audio error codes, renderer failures and connection-state changes. Logs stay under `%LOCALAPPDATA%\ScreenTask\Diagnostics` (LOCAL QA uses its isolated profile). Missing a clean session end can mean a crash, forced termination or power loss; it does not by itself establish the cause.

Windows history is limited to 8 MiB and 32 files; busy history may cover less than 24 hours. Linux/browser export provides a smaller local JSON history of up to 256 events over 24 hours. Logs contain no captured audio/video, chat, credentials, room/peer identities, device names or network addresses, and are not uploaded automatically. Share the export with the developer when reporting the failure and note approximately when it happened. A completely frozen or terminated operating system may prevent the final event from reaching disk.

### App sounds

Open **App sounds** in Settings to toggle event cues and adjust their independent volume from 0–300%. Preview uses the draft volume; Save applies it to the app and current room. Defaults are louder than earlier builds. This setting does not change voice, microphone or screen playback volume.

## Settings and updates

Open **Settings** outside the room or the room's **Stream settings**. FPS, resolution ceiling, bitrate per participant, text/motion preference and screen audio synchronize and persist on the device. Choose **Save stream settings** to confirm room-quality edits; dismissing the panel discards unsaved edits. Saved settings apply to active capture where the browser supports them. Screen audio must have been selected when capture started. Actual FPS depends on capture hardware, CPU and each peer connection.

The compact dark title bar supports dragging, double-click maximize/restore, window controls and edge resize.

Closing the window with **X** or **Alt+F4** hides Vumiro in the Windows system tray, including the hidden-icons area if Windows places it there. Your room, microphone, screen sharing and online connection keep running. Double-click the tray icon or right-click it and choose **Open Vumiro** to return. Choose **Quit Vumiro** from its tray menu to fully exit. The minimize button still minimizes to the taskbar. Updates and Windows shutdown can close the app normally.

Version 1.16.1 adds a subtle frosted window background on supported Windows systems. Text and streams keep their normal opacity. The effect follows Windows transparency and high-contrast settings; other systems retain the solid dark theme.

Version 1.17.0 adds picture panning and zoom before saving, participant profile popups with friend requests, clearer call icons, and a red startup spinner. Click the sidebar Vumiro logo or Friends to browse without disconnecting your room, then choose Return to room. The People list scrolls only when its contents exceed the available height.

**Updates → Update now** rechecks GitHub release metadata, verifies SHA-256, size and executable identities, then restarts through a separate helper. Leave the room before updating. Failed file copies roll back. Executables are unsigned; publisher-account integrity is the update trust anchor.

## Local data and connectivity

Profiles, nonextractable P-256 signing keys, friends, pictures, blocks and settings remain under `%LOCALAPPDATA%\ScreenTask\ClientBrowser`. That compatibility folder and the existing WebView origin deliberately keep their old internal names to preserve identities. Normal browsers use separate identities. Clearing that data loses the local key/contact book.

The Worker handles temporary online metadata, requests, room discovery and signaling. Friend requests store bounded public identities and signed proofs until answered/expired; completed outcomes remain for at most seven days or until both apps acknowledge them. Delivery and replay are pushed over the existing WebSocket, without polling. Expiry uses server time supplied during the existing handshake rather than requiring synchronized PC clocks. Media, messages and pictures remain direct P2P. There is no TURN relay; restrictive NAT/firewall combinations can prevent direct connections even when signaling succeeds. Participants receive peer network addresses and may record shared content.

Build/package: `./scripts/Build-Client.ps1`. The [restore guide](RESTORE.md) records the committed baseline and complete pre-cleanup backup. Runtime behavior in this iteration awaits your feedback; compilation/syntax checks are not an end-to-end security audit.
