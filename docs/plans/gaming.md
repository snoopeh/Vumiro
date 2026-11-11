# Gaming implementation plan

## Goal and design
Add Gaming to the existing main navigation with LAN tunneling, Game together and Controller mappings, using the app's dark theme and red accent. Preserve the concurrent agent's changes through a separate `codex/gaming` worktree and apply only this feature's diff at integration.

Use the installed ZeroTier service for real encrypted virtual LAN membership and assigned addresses. Private network creation and member authorization use ZeroTier Central. Use installed Sunshine for hosting and Moonlight for pairing and launching remote sessions. Those components provide hardware accelerated video/audio and controller forwarding. Build the keyboard mapper into Vumiro: a native foreground-scoped keyboard hook drives a virtual Xbox controller through ViGEm; Moonlight forwards that controller to the remote host. A physical controller bypasses the mapper. The diagram is interactive SVG using theme colors and all standard controls.

Alternatives considered: implementing a new tunnel/streaming stack would require a separate driver, NAT traversal, codec and deployment program; merely opening vendor websites would not deliver membership or usable mapped input. Installed provider integration offers actual operations and visible setup/readiness without claiming the providers are bundled or replacing their account/pairing flows. ViGEm is end of life, so explicitly disclose its compatibility role and missing driver status.

## Boundaries and acceptance
- Gaming modules own their UI, profile persistence, RPC and native adapters; minimal edits to shared navigation, startup, resource and check manifests.
- ZeroTier secrets stay native. Network IDs, hosts, components and mapper codes are validated. External URLs and executables are allowlisted. Never execute arbitrary page-provided commands.
- Mapping activation is explicit. Release controls on focus change, stop, Escape, navigation and heartbeat expiry. Do not capture unrelated apps or text entry by default. Save custom profiles locally; export/import bounded validated JSON.
- Show actual network state and assigned addresses, permission failures, unavailable providers and host/client readiness. Pairing/streaming launch acknowledgement does not mean a remote session is connected.
- No version bump, release, production deployment, destructive reset or changes to the other agent's files beyond a narrow additive merge.

## Slices
- [x] Baseline focused checks; failing pure engine, RPC/profile and native validation tests.
- [x] Native ZeroTier and Sunshine/Moonlight adapters with restricted bridge.
- [x] Native virtual controller and pure keyboard mapping engine.
- [x] Gaming navigation, setup/status flows, accessible controller diagram, mappings and local profiles.
- [x] Resource packaging/check coverage and integration verification.
- [x] Commit the isolated feature and merge narrowly into the original checkout preserving every concurrent edit.

## Validation
Node behavior tests cover invalid persisted profiles/imports, conflicting bindings, normalized axes, RPC failure/timeouts and response correlation. Native console checks exercise network/host validation, HTTP behaviors and controller state boundaries without requiring a live peer or installed driver. Run client checks and native build. Hardware gameplay, LAN authorization, remote latency and Steam enumeration require two Windows computers with the optional providers and drivers; report that limitation precisely.

The user explicitly authorized autonomous decisions and isolated development followed by integration; approval pauses from generic workflow skills are waived by those instructions.

## Integration result
Feature commits remain on `codex/gaming`; the source was merged into the original checkout with per-file backups under `dist/gaming-integration/before`. Other agent changes remain uncommitted and were not staged, reset or included in feature commits. Combined checks passed 675 client tests, 89 backend tests and all ten native groups before the final localization/room-navigation polish; those final UI changes have focused regressions. The actual LOCAL QA WebView validated three routes, all 24 controller controls, rebinding, Tab behavior, real native mapper start/stop and layout. Two-PC gameplay and host Steam enumeration still require human QA.
