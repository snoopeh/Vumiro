# ScreenTask local client 1.14.0

Extract the entire archive and run **ScreenTask.Client.exe** on Windows 10/11 x64. Requires .NET Framework 4.8 and the Microsoft Edge WebView2 Runtime. No administrator access or local sharing server is needed.

1. Create a local profile with your display name. This creates a device identity, without a cloud account or password.
2. Copy your contact code and exchange codes with your friend. **Both people must add each other's code**. Save a nickname if you like.
3. Choose **Create room** to open your own private room immediately, even without any friends added. Use **Copy invitation** inside the room to invite mutual friends; they can join from the link or paste it into **Join with invitation**. You and the owner must have added each other's contact codes, and the owner must be connected. Alternatively, select an online friend and call; they accept inside their app.
4. In the call, choose **Share screen** and select a display/window. Microphone and screen audio are optional. Either participant can share. Use **Actual size** or **Fullscreen** to read small text.
5. End the call to return to friends. Closing the app stops sharing and makes you offline.

The Cloudflare Worker coordinates presence, signed invitations and WebRTC connection setup. Screen video and voice flow directly between participants, encrypted by WebRTC. The app configures no TURN/media relay. Restrictive networks may prevent a direct connection; the app does not silently route media through a server.

Your profile, private signing key and friend book live in the local WebView2 profile at `%LOCALAPPDATA%\ScreenTask\ClientBrowser`. The private key is nonextractable through the app's Web Crypto API. Your public identity and temporary friend-ID subscriptions/access policy go to the Worker while connected; names and friend-book records are not uploaded as a cloud account database. Call display names accompany authenticated room membership. Calls require both people online; offline invitations are not stored. Only one active directory session per identity is supported.

## Updates

Get the desktop client from [the repository's client release](https://github.com/snoopeh/ScreenTask/releases/tag/client-v1.14.0). The download is a ZIP because the application is portable; extracting once installs the files without administrator access. Version 1.13 and older need this one bootstrap installation to gain the updater.

Open **Updates** in the sidebar, choose **Check for updates**, then **Update now** when available. The app also checks at startup. Leave your room first. Installing verifies the repository asset's SHA-256 digest, download size and executable versions, then restarts the app. Your profile and friends stay in their existing local data folder. Failed copies trigger rollback; previous application files remain in an update backup folder.

The dedicated `client-v*` release channel is separate from legacy server releases. The updater accepts only stable assets from `snoopeh/ScreenTask` through GitHub HTTPS. It contains no publisher token. GitHub's publisher account/release integrity is the update trust anchor; these Windows executables are not Authenticode signed. Keep the app in a writable folder.

## Friend-only access

Online status and direct invitations require mutual addition; adding someone's public code alone does not make them reachable. Invitations are signed and expire. Room entry requires a fresh device-key proof and mutual friendship with the room owner. A leaked room URL alone grants no access. Group rooms admit the **owner's** mutual friends; participants need not all be friends with one another. The owner must remain connected. Removing a friend removes direct-call/presence access and revokes that person's access to your current room. Old anonymous room codes are no longer accepted; create fresh rooms after updating.

These controls do not protect against a compromised device or someone you deliberately add as a friend. Participants can record what you share, and direct connections reveal network addresses to peers. Do not share your device's local browser profile or import untrusted contact codes as friends.

Contact codes are public identity cards, not recovery backups. Clearing the local browser profile loses this identity and its friend book. The browser-hosted client uses its own browser storage and therefore a separate identity from the desktop app.

Sharing defaults to 60 FPS and a 20 Mbps cap per participant, or imports the legacy app's saved FPS/bitrate on startup. Adjust these in the client settings before a call. WebRTC adapts to each connection; requested FPS is not a guarantee. The new package reuses the direct WebRTC client and omits the legacy HTTP server, FFmpeg and native audio helper. The old application remains available separately for legacy features.

Build/package: `powershell -File scripts/Build-Client.ps1`. Runtime testing for this iteration is left to the user as requested.
