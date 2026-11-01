# Vumiro 1.15

Share your view. Local profiles, friends and direct screen/voice rooms in a small Windows app.

Get [Vumiro 1.15](https://github.com/snoopeh/ScreenTask/releases/tag/client-v1.15.0), extract **Vumiro-win-x64.zip**, and run **ScreenTask.Client.exe**. Windows 10/11 x64, .NET Framework 4.8 and Microsoft Edge WebView2 Runtime are required. No administrator access or local sharing server is needed. Existing 1.14 clients can install through **Updates → Update now**; profiles and friends are preserved.

## Friends and profiles

Create a local display name, then open **Your profile** to choose an optional username and picture. Usernames are online lookup handles, not permanent cloud accounts. Your public identity remains tied to the device key, not its display name.

Choose **Add friend**, enter their username or contact code, and Vumiro fills their current name automatically. Send a request; they receive **Accept**, **Decline** and **Block** controls. Accepting updates both contact books. Both people must be online; pending requests expire and have no offline cloud mailbox. Reconnect and resend if either person went offline before acceptance.

If someone has no username or is offline, **Save code locally** keeps the manual contact-code flow. Names fill from the verified code; both people must add each other's codes before calling. Local nicknames are optional overrides; leave them empty to follow the current name automatically. Blocked identities can be unblocked from your profile.

Pictures are resized and saved locally. Names/usernames use temporary directory metadata; pictures travel only through a direct peer connection and are cached for known friends. A friend's latest picture appears after connecting in a room, rather than being uploaded to Cloudflare.

## Rooms, chat and reconnect

Choose **Create room**. Mutual friends see it under **Rooms → Friends' rooms** and receive an in-app room notification. Lists update when rooms open/close or begin sharing, when friends come online, when you open Rooms, and after reconnecting. No room-discovery polling timer runs.

Choose **Request to join**; the owner accepts inside Vumiro. A copied invitation also goes through owner approval. Direct call invitations include approval. A room link alone grants no access: guests prove their identity and present an owner-signed grant, and both sides must still be friends. Group participants are friends of the owner; they need not all be friends with one another. The owner must remain connected.

Either participant can share a screen, enable a microphone, and send **room chat**. Chat and pictures use WebRTC data channels, not the Worker. Chat is bounded, live and local to the open room; there is no cloud history or delivery to disconnected peers. Double-click a stream to toggle fullscreen; **Actual size** remains available for small text.

Use **Reconnect** in the sidebar for the presence service, or the room's **Reconnect** button for its connection. Automatic backoff remains available. Reconnecting retains the room and an unexpired approval, and can retain an existing capture. You still choose what to share through the system picker. Leaving or closing stops capture. Expired approvals require requesting entry again.

## Stream and window settings

Open **Settings** outside the room or **Stream settings** inside it. Changes synchronize and persist locally. Controls: 1–120 FPS, native/720p/1080p/1440p/2160p resolution ceiling, 1–100 Mbps per participant, text/detail or motion preference, and screen audio. FPS/bitrate/resolution apply to the active capture where supported. Enabling screen audio requires choosing audio when capture starts; existing captured audio can be paused/resumed. Actual FPS depends on the device and each connection.

Drag the compact dark title bar to move the window, double-click it to maximize/restore, and use minimize/maximize/close. Edges resize; fullscreen restores the same dark frame.

## Updates and local data

The app checks stable client releases at startup. **Updates → Update now** verifies GitHub's SHA-256 digest, package size and executable versions, then restarts to install. Leave the room first. Failed copies roll back; local profile data is not an update target. Version 1.13 and older need one bootstrap installation to gain the updater. Executables are unsigned; GitHub publisher-account/release integrity is the update trust anchor.

Profiles, nonextractable P-256 signing keys, friends, pictures and blocks stay under `%LOCALAPPDATA%\ScreenTask\ClientBrowser`. The origin and folder keep their existing names so rebranding does not create another identity. Contact codes are public identity cards, not recovery backups. Clearing local profile data loses the identity. Normal browsers use separate storage and identities.

The Worker handles bounded live public profile/username metadata, requests, room announcements and signaling, without a persistent account database. Screen, voice, chat and pictures stay direct P2P. No TURN/media relay is configured; restrictive networks can prevent connections. Adding a contact grants trust in that identity, not proof of a person's real-world identity. Participants can record what you share; direct connections expose peer network addresses.

Build/package: `powershell -File scripts/Build-Client.ps1`. Brand sources and icon/font embedding scripts are included in the repository. Runtime streaming, chat, update-install and security testing for this iteration are left to the user as requested.
