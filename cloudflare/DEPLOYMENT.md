# Active Vumiro deployment

- Published/deployed: 2026-11-01.
- Source release: `5a01537e9c1b60972e0edab35d83e5b94249bac7`, tag `client-v1.16.1`.
- Windows release: https://github.com/snoopeh/Vumiro/releases/tag/client-v1.16.1
- Build/release workflow: https://github.com/snoopeh/Vumiro/actions/runs/41329386029 (success).
- Main build/syntax workflow: https://github.com/snoopeh/Vumiro/actions/runs/41329383444 (success).
- Published `Vumiro-win-x64.zip`: 455201 bytes; SHA-256 `8eb560d02381c5fc1dcdb93fb6110df60c6c82ff3aa261c9cad87ba61364a685`.
- Package inspection: exactly 18 allowed files; `Vumiro.exe` and `Vumiro.Updater.exe` version 1.16.1.0. The desktop shortcut uses the downloaded, checksum-verified published package.
- Worker unchanged by the desktop-only 1.16.1 backdrop update.
- Worker: `screentask-rooms`, version `7b0c29c5-5b10-481d-8b2f-66cdab4d53f4`.
- Service: https://screentask-rooms.screentask-room-signaling.workers.dev
- Endpoints: `/friends-signaling`, `/call-signaling`.
- Bindings: `CALL_ROOMS` (CallRoom), `FRIEND_DIRECTORY` (FriendDirectory), `ASSETS` (six client assets).
- Existing Worker name, migration history, DO bindings and desktop identity origin remain stable. No profile/key database or TURN/media relay was added.
- Runtime behavior is left to user feedback as requested; no runtime test suite or app-driven QA was run.

The [pre-cleanup restore point](../docs/RESTORE.md) contains the committed/pushed original source, a verified all-history bundle, full ignored-file snapshot and separate closed-app local profile copy.
