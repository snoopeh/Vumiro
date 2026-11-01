# Architecture

Reuse the local WebView2 shell, IndexedDB P-256 identity, direct WebRTC mesh and existing updater. Split implementation ownership among the directory protocol, friends/profile surface, room/media surface and native shell/release.

Cloudflare retains only live coordination metadata: authenticated public profile/optional username, friend request and join envelopes, presence subscriptions, blocked IDs and owned room announcements. It stores no persistent account database or offline mailbox. Public names are ephemeral online metadata; keys and authoritative contacts remain local. Signed owner grants bind room access to the requesting device identity.

Chat and profile pictures use WebRTC data channels; neither is forwarded through the Worker. Avatars are compressed and bounded, persisted locally and shared when peers connect. Live-room discovery is event-driven, with explicit snapshots instead of polling.

Preserve https://screentask.local and %LOCALAPPDATA%/ScreenTask/ClientBrowser so branding does not lose identities. Preserve internal executable names and the client-v release asset for 1.14 updater compatibility; publish a Vumiro download alias. New icon/font source assets compile/embed into existing application files so old strict extraction rules still work.
