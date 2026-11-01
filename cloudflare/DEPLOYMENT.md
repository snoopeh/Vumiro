# Active Vumiro deployment

- Published/deployed: 2026-11-01.
- Source release: `6c09f6239adc7051c6acc43ea39d1d322df92f0e`, tag `client-v1.16.0`.
- Windows release: https://github.com/snoopeh/Vumiro/releases/tag/client-v1.16.0
- Build/release workflow: https://github.com/snoopeh/Vumiro/actions/runs/41328332962 (success).
- Main build/syntax workflow: https://github.com/snoopeh/Vumiro/actions/runs/41328330254 (success).
- Published `Vumiro-win-x64.zip`: 454431 bytes; SHA-256 `2cc41b94881d60e057f7d30c3730619808b120564afb0ac450402ec1397dee32`.
- Package inspection: exactly 18 allowed files; `Vumiro.exe` and `Vumiro.Updater.exe` version 1.16.0.0. The desktop shortcut uses the downloaded, checksum-verified published package.
- Worker: `screentask-rooms`, version `7b0c29c5-5b10-481d-8b2f-66cdab4d53f4`.
- Service: https://screentask-rooms.screentask-room-signaling.workers.dev
- Endpoints: `/friends-signaling`, `/call-signaling`.
- Bindings: `CALL_ROOMS` (CallRoom), `FRIEND_DIRECTORY` (FriendDirectory), `ASSETS` (six client assets).
- Existing Worker name, migration history, DO bindings and desktop identity origin remain stable. No profile/key database or TURN/media relay was added.
- Runtime behavior is left to user feedback as requested; no runtime test suite or app-driven QA was run.

The [pre-cleanup restore point](../docs/RESTORE.md) contains the committed/pushed original source, a verified all-history bundle, full ignored-file snapshot and separate closed-app local profile copy.
