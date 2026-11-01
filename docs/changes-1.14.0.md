# ScreenTask Client 1.14.0

Local profiles and friends, private rooms and direct screen/voice sharing in a small Windows desktop client. No local sharing server is required.

- **Updates inside the app:** automatic startup checks and Updates → Update now. Downloads come from this repository's dedicated client release channel, with SHA-256, size and executable-version checks before restart. Local identities and friends stay in place; failed file copies roll back.
- **Mutual friends only:** online status and direct call invitations require both people to add each other's contact codes.
- **Private rooms:** every participant proves possession of their local identity key. Guests must be mutual friends of the connected room owner. A leaked room link alone does not grant access. Removing friends revokes their access to your room.
- **Direct media:** Cloudflare handles presence, invitations and signaling; screen and voice remain peer to peer. No TURN/media relay is configured.

Download and extract **ScreenTask-client-win-x64.zip**, then run **ScreenTask.Client.exe**. Windows 10/11 x64, .NET Framework 4.8 and Microsoft Edge WebView2 Runtime are required. Version 1.13 and older need this one bootstrap installation to gain the updater. New versions will then be available through the app.

After updating, create fresh rooms: old anonymous room links are no longer accepted. Group guests are friends of the room owner; they need not all be friends with each other. The owner must remain connected. Direct connections can fail on restrictive networks.

Build compilation and JavaScript syntax checks passed. Runtime streaming, update installation and security testing are left to the user for this iteration. These executables are unsigned; GitHub publisher-account integrity is the update trust anchor. See [the client guide](https://github.com/snoopeh/ScreenTask/blob/main/docs/CLIENT.md) for local data, controls and access rules.
