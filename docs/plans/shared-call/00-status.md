# Shared call and stable playback

Product, architecture, program design and slice decisions are recorded here. The user's standing instruction grants autonomous implementation and waives approval questions; no separate gate approval is claimed.

- [x] Inspect user telemetry and the “Add Cloudflare P2P handshaking” conversation.
- [x] Preserve and blend the last frame across playback resets.
- [x] Repair missing FFmpeg in development builds and honor chosen FPS in calls.
- [x] Add shared room signaling and simultaneous peer screen sharing.
- [x] Embed the call inside the desktop app; joining does not start a local server.
- [x] Supply a Cloudflare signaling-only service, validate locally, package the app.

Cloudflare deployment completed on 2026-11-01 after the user authorized the account. Endpoint: https://screentask-rooms.screentask-room-signaling.workers.dev. The app defaults and saved preferences now use its WSS signaling route. No TURN/media relay is authorized: the user's earlier chat explicitly excludes it. No additional tests were run during deployment, per the user's request; streaming feedback is left to the user.

Earlier validation: frame-hold and catch-up unit tests; Chrome/Edge/Chrome six simultaneous incoming video paths, screen/microphone audio, room isolation and reconnect; real Cloudflare Worker runtime bounds/routing tests; native WebView2 join/share with listener remaining stopped; layout and live HDR/audio/file tests. Local HTTP H.264/NVENC receiver measured 54.9 FPS at a 60 FPS target (three-second sample; this is not a remote network guarantee).
