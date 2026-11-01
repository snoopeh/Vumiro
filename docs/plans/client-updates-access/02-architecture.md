# Architecture

Client releases use the existing snoopeh/ScreenTask repository with dedicated client-v* tags and ScreenTask-client-win-x64.zip assets. A native controller checks published stable client releases through HTTPS GitHub API; SHA-256 digest, size, exact asset URL and assembly version are verified before a small helper installs with rollback. No GitHub token ships in the app.

Directory presence and invitation routing require both live authenticated sockets to watch each other's identity. Friend lists remain authoritative on devices; ephemeral watches are access policy for the current connection.

Room codes bind the owner's public identity to a random nonce. Every member proves possession of its local signing key through a room challenge. The owner supplies a signed local friend-ID list; nonowners must appear there and also list the owner. Room membership and permitted signaling remain in WebSocket attachments. Profiles and private keys are not stored in a cloud account database. Media remains direct WebRTC.
