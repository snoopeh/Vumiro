# Active Vumiro deployment

- Published/deployed: 2026-11-01.
- Source release tag: `client-v1.19.0`.
- Windows release: https://github.com/snoopeh/Vumiro/releases/tag/client-v1.19.0
- Build/release workflows: https://github.com/snoopeh/Vumiro/actions
- Local package: `../dist/vumiro-1.19.0/Vumiro-win-x64.zip`. Published checksums accompany the release assets.
- Both Windows executables use version 1.19.0.0; packaging retains the existing six-web-asset allowlist for updater compatibility.
- Worker: `screentask-rooms`, version `99fbf554-bd20-4369-9e59-27c40cbbc814`.
- Service: https://screentask-rooms.screentask-room-signaling.workers.dev
- Endpoints: `/friends-signaling`, `/call-signaling`.
- Bindings: `CALL_ROOMS` (CallRoom), `FRIEND_DIRECTORY` (FriendDirectory), `ASSETS` (six client assets).
- Existing Worker name, migration history, DO bindings and desktop identity origin remain stable. The existing SQLite FriendDirectory now keeps bounded version 2 friend-request proofs and public identities: 24-hour pending lifetime, up to seven days for terminal replay, early deletion after both receipts. No private keys, pictures, chat or media are stored.
- New friend states are pushed over the existing WebSocket. Reconnection replay uses indexed identity lookups; one-shot alarms target actual expirations. No periodic network polling was added. Legacy version 1 traffic remains available, but both peers need 1.19 for durable requests.
- Runtime behavior is left to user feedback as requested; no runtime test suite or app-driven QA was run.

The [pre-cleanup restore point](../docs/RESTORE.md) contains the committed/pushed original source, a verified all-history bundle, full ignored-file snapshot and separate closed-app local profile copy.
