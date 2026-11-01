# Vumiro social release

The user explicitly authorizes autonomous work and delegation, and previously deferred runtime tests to their own feedback. Software-factory approval pauses and runtime test steps remain waived by those instructions; no separate gate approvals are claimed.

Design references: the attached Vumiro red/black ribbon-V identity and compact custom title bars. Product, architecture, design and slices are recorded in the adjacent documents; backend wire contracts are in PROTOCOL.md.

- [x] Friend requests, acceptance, online username lookup and code fallback.
- [x] Event-driven live rooms, join requests/approval and reconnect controls.
- [x] P2P room chat, avatars, fullscreen gestures and shared stream settings.
- [x] Vumiro branding/icon and custom native window frame.
- [x] Build, publish repository release, deploy Worker and update local shortcut.

Maintain the existing local origin, IndexedDB identity and data folder. Version target 1.15.0; old client-v update channel and existing package file layout remain compatible with 1.14's strict updater. No runtime tests or app launch in this iteration unless the user changes that instruction.

Local release app/helper compile with zero warnings/errors; JS syntax and integration review passed. Review corrections: confirmed social acknowledgements before acceptance success, capacity preflight, async request guards, a 64 KiB received room-snapshot limit, and canonical forward-slash ZIP entries on both Windows PowerShell and modern CI. Package contains the same 17 allowed files; icon/font resources compile/embed into them.

Delivered 2026-11-01: source ab330d3 on origin/main, client-v1.15.0 public release, successful GitHub release build 41282510134. Both public archive names have SHA-256 993ce3d64b92b403e40d33c4ed41d078ff3e19b868907f92437f048b8ce2057b and size440744 bytes. Worker version340d898c-c1f2-46b6-ace6-c38a597fa55e deployed. Desktop Vumiro.lnk targets dist/vumiro-1.15.0/ScreenTask/ScreenTask.Client.exe; previous shortcut is preserved beside that package. Profiles keep the existing origin/data folder. No application launch or runtime tests were performed; visual, streaming, social and update-install feedback remain with the user.
