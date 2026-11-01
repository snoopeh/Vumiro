# Active deployment

- Deployed: 2026-11-01, via Wrangler OAuth authorized by the account owner.
- Service: https://screentask-rooms.screentask-room-signaling.workers.dev
- Signaling: wss://screentask-rooms.screentask-room-signaling.workers.dev/call-signaling
- Worker: screentask-rooms
- Presence/invitations: wss://screentask-rooms.screentask-room-signaling.workers.dev/friends-signaling
- Version: 340d898c-c1f2-46b6-ace6-c38a597fa55e
- Bindings: CALL_ROOMS (CallRoom), FRIEND_DIRECTORY (FriendDirectory), ASSETS (five public client assets).
- Migration v2 adds FriendDirectory; its state is limited to live WebSocket attachments, without persistent profile or friend-book records.
- Root opens the friends client; /call retains room invitations. Desktop client uses packaged local assets at https://screentask.local.
- Client 1.13.1 adds Create room to the toolbar and Rooms menu; room codes are generated on-device and use the existing signaling route.
- Client 1.14.0 requires mutual friends for presence/invitations and identity-proven room membership. Guest admission requires mutual friendship with the connected room owner. Signed policy revisions revoke removed friends. Legacy anonymous rooms are rejected. GitHub client release: https://github.com/snoopeh/ScreenTask/releases/tag/client-v1.14.0.
- Vumiro 1.15.0 adds ephemeral online username/profile lookup, signed friend acceptance/blocks, event-driven live-room snapshots and signed join approval. Guest authentication requires an owner-signed identity-bound grant. Chat and avatars use P2P data channels only. Public release: https://github.com/snoopeh/ScreenTask/releases/tag/client-v1.15.0.
- No TURN/media relay. End-to-end streaming feedback is left to the user as requested.
