# Active deployment

- Deployed: 2026-11-01, via Wrangler OAuth authorized by the account owner.
- Service: https://screentask-rooms.screentask-room-signaling.workers.dev
- Signaling: wss://screentask-rooms.screentask-room-signaling.workers.dev/call-signaling
- Worker: screentask-rooms
- Presence/invitations: wss://screentask-rooms.screentask-room-signaling.workers.dev/friends-signaling
- Version: ad15380e-f4cc-46bd-b200-5d1e2809072d
- Bindings: CALL_ROOMS (CallRoom), FRIEND_DIRECTORY (FriendDirectory), ASSETS (five public client assets).
- Migration v2 adds FriendDirectory; its state is limited to live WebSocket attachments, without persistent profile or friend-book records.
- Root opens the friends client; /call retains room invitations. Desktop client uses packaged local assets at https://screentask.local.
- Client 1.13.1 adds Create room to the toolbar and Rooms menu; room codes are generated on-device and use the existing signaling route.
- No TURN/media relay. End-to-end streaming feedback is left to the user as requested.
