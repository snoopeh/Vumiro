# Community Hub implementation

Approved source: [user plan](PLAN.md). The user requested autonomous implementation and scoped changes alongside other agents. Work is isolated in `Vumiro-CommunityHub`, branch `codex/community-hub`, from `69a6efc`. The original checkout and its branch are untouched.

## Ownership

- Tree worker: community-model.js, model tests and model contract.
- Theme worker: community-themes.js, community-studio.js, theme CLI, starter packages, tests and creator kit.
- Service worker: community backend/auth/routes/config, live and voice adapters, tests and service contract.
- Root: community-workspace.js, view tests, shared shell labels/entry, asset packaging, check registration, integration and QA.
- Workers do not commit. Root stages explicit owned paths after verification. No release version, tag, deployment or production data change is authorized by this implementation.

## Execution record

- Existing sandbox baseline: 30/30 tests passed before changes.
- Workspace tests initially failed for missing community API and packaging; view tests now exercise real model forms, draft preservation, search input stability, authority configuration and stale identity callbacks.
- Model and theme engine workers established red/green focused tests.
- Native worktree registration targeted the parent workspace repository and could not resolve Vumiro's commit. Created a Git worktree from the exact Vumiro repository instead.
- Ruling: retain server-workspace.js as the compatibility and legacy data boundary, introduce independent community model/view modules, and switch only the user-facing entry. This preserves existing migration input and compatibility identifiers; it leaves the legacy view API available to older integrations.
- Ruling: portable packages use bounded JSON `.vumirotheme` files; arbitrary ZIP input is rejected. This eliminates extraction traversal and decompression risks, at the cost of larger base64 assets.
- Delivered nested multi-hub workspace, migration, homes, keyboard tree management, access/delegation/authority previews, isolated theme engine and Studio, portable creator kit and original showcase packages.
- Delivered dedicated authenticated Cloudflare community storage, explicit local publication, invitations, durable text/reconnect, revision edits, moderation/audit, Space admission/approval, archive restoration, private R2 theme transfer, and separate SFU media adapter with session cleanup.
- Integrated all new modules into Windows, Linux, Cloudflare and frozen updater asset paths. Registered focused and complete checks without renaming compatibility routes or legacy storage.
- Reviews fixed ancestor theme overrides, access/theme creation authorization, restricted-source reparent authorization, scoped restore authority, large raster encoding, newest history recovery, voice attempt cleanup races, stale identity continuations, persistent retry IDs, identity-isolated assets/metadata, invitation notice cleanup, authorized shared-package isolation/fallback, and delegated moderation controls.
- Real Windows LOCAL QA inspection exercised first-run profile creation, nested navigation, baseline/Viking/Cyberpunk appearance and Theme Studio. It exposed and fixed a first-run lobby initialization blocker and an overly heavy baseline border. The app remains a clearly marked LOCAL QA build using the isolated checkout and data root.
- Real local Wrangler HTTP/WebSocket/R2 integration passed 16/16 checks using generated ephemeral P-256 test identities. Report: `dist/community-service-qa.json`. The tests verify nonce replay rejection, identity-bound invites, signed socket challenge, durable acknowledgments/idempotency, authorization, revision conflicts, equal authority, delegation, private raster access, immediate subscription revocation and audit privacy.
- Full client/backend/native verification command: `node scripts/Check-Client.mjs --native --output dist/community-final-checks`. Read its machine receipt for exact source fingerprint, totals and status. During final review an earlier complete run passed all executable groups but correctly rejected its receipt because review fixes changed source concurrently; the final run must use stable inputs.
- Native QA launch: `./scripts/Run-Local.ps1 -LocalService -SkipTests` after the complete gate (default full launcher also ran earlier). Linux asset/trusted-route/smoke compatibility tests are included; a Linux desktop was unavailable.

## Release acceptance still outstanding

- Provision production Durable Object/R2 bindings and SFU credentials through the established release process. No deployment, production write, version bump, tag, push or release was performed.
- Validate real SFU microphone/playback/network behavior with multiple devices and human acceptance. Adapter and authorization/cleanup regressions run locally; real SFU credentials were unavailable.
- Measure the proposed 500-member, 100 simultaneous text-connection and 25-person voice targets before advertising capacity. These are acceptance targets, not measured claims.
- Run real Linux desktop/device interaction QA and human visual acceptance. Agent-operated Windows checks and automated compatibility tests do not replace that acceptance.
