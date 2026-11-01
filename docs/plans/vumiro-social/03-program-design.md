# Program design

FriendDirectory validates signed social envelopes, bounded pending/replay records, online username claims and mutual-friend room announcements. CallRoom verifies an owner-signed recipient/room grant before guest admission, in addition to device proof and current mutual friendship. Rate limits and bounded hibernating socket attachments remain in place.

local-profile.js migrates optional username/avatar/contact metadata and pending requests without changing identity keys. friends-client.js owns approval notifications, discovery snapshots and iframe lifecycle. call-client.js owns reliable bounded P2P chat, avatar transfer, settings application and room-state callbacks. Shared stream settings persist in localStorage and synchronize between the parent and iframe.

The native host uses a dark borderless frame, constrained window-control messages from the trusted main page, native dragging/resizing and monitor-aware maximize/fullscreen. Updates keep the existing trusted-origin action bridge and repository verification.

Validation is limited to compilation, syntax checks, code review and actual release/deploy output. Runtime/chat/stream behavior remains for user feedback per their instruction. Online usernames are not permanent cloud accounts; avatar updates arrive through a peer connection. Peer IP visibility and restrictive-network limitations remain.
