# Active Vumiro deployment

- Published/deployed: 2026-11-01.
- Source release tag: `client-v1.21.1`.
- Windows and Linux release: https://github.com/snoopeh/Vumiro/releases/tag/client-v1.21.1
- Build/release workflows: https://github.com/snoopeh/Vumiro/actions
- Local Windows package: `../dist/vumiro-1.21.1/Vumiro-win-x64.zip`. Linux AppImage/deb/rpm packages build in Ubuntu CI. Published checksums accompany the release assets.
- Both Windows executables use version 1.21.1.0; Linux package version is 1.21.1. Windows packaging retains the existing six-web-asset allowlist for updater compatibility.
- Public Worker: `vumiro-rooms`, version `45b506db-b76e-4aa7-85b4-0be93079571f`.
- Internal storage owner: `screentask-rooms`, version `cbc3d285-c3ec-4d2e-b1cf-7613b3a1f864`. Its public workers.dev route is disabled; its original v1/v2 migrations are retained in `wrangler.storage.jsonc`.
- Windows stream audio is captured locally using WASAPI; audio and Discord filtering add no service endpoints or cloud polling.
- Linux's exact local origin `vumiro://app` is permitted alongside the existing Windows origin.
- Service: https://vumiro-rooms.vumiro-signaling.workers.dev
- Endpoints: `/friends-signaling`, `/call-signaling`.
- Bindings: `CALL_ROOMS` (CallRoom), `FRIEND_DIRECTORY` (FriendDirectory), `ASSETS` (six client assets).
- The account workers.dev subdomain is now `vumiro-signaling`, changed through the Cloudflare dashboard. Public Worker bindings point directly to the original namespaces: `CALL_ROOMS` → `94c55c72903c4d80b15a6c620e3ef41b`, `FRIEND_DIRECTORY` → `9902bed8deae4a09b81cdb67f985d3dd`. Both IDs were verified unchanged after deployment. No data transfer, replacement namespace or proxy hop was introduced.
- Desktop identity origins and local storage remain stable. The existing SQLite FriendDirectory keeps bounded version 2 friend-request proofs and public identities: 24-hour pending lifetime, up to seven days for terminal replay, early deletion after both receipts. No private keys, pictures, chat or media are stored.
- New friend states are pushed over the existing WebSocket. Reconnection replay uses indexed identity lookups; one-shot alarms target actual expirations. No periodic network polling was added. Legacy version 1 traffic remains available, but both peers need 1.19 for durable requests.
- Runtime behavior is left to user feedback as requested; no runtime test suite or app-driven QA was run.

The [pre-cleanup restore point](../docs/RESTORE.md) contains the committed/pushed original source, a verified all-history bundle, full ignored-file snapshot and separate closed-app local profile copy.

## Completed 1.21.1 URL migration

Client 1.21.1 is published as the stable/latest release with all six assets. Release CI `41341372589` succeeded. The app remaps known legacy saved URLs and room invitations while preserving custom connection services. Older clients need the GitHub update because the account rename retires the old service URLs.

The dashboard confirmed the new subdomain and Wrangler deployed the canonical route. API metadata confirmed the public route enabled, internal storage route disabled, and original Durable Object bindings retained. No live room/audio runtime tests were run.
