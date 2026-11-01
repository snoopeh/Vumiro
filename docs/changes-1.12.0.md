# ScreenTask 1.12.0

- Hold the last decoded frame during seeks, decoder resets and JPEG/H.264 transitions; blend into the replacement over 100 ms. This avoids blank flashes without synthesizing every intermediate video frame.
- Resolve packaged FFmpeg for development runs. Prefer NVIDIA NVENC when available, then Media Foundation and software H.264. Missing FFmpeg previously left development builds using bandwidth-heavy GDI/JPEG.
- Honor configured direct-share FPS instead of hard-capping it at 30. Receiving FPS still depends on capture, encoding, network and decoding; room telemetry shows measured decoded FPS.
- Add an embedded Call tab. Everyone can join, share, stop/restart a share, and use a microphone in the same room. Joining does not start a local server. Up to eight participants use direct peer connections.
- Add compatible local room signaling and a deployable Cloudflare Worker/Durable Object service. Only SDP/ICE setup passes through signaling. No TURN or media relay is configured.
- Public calls require deploying the Worker to an authenticated Cloudflare account. A custom domain is optional; no account or public endpoint is created automatically.

Validation covers last-frame retention, real decoder transitions, local and Worker three-peer media, independent microphone/screen audio, room isolation, limits and reconnects. A native WebView2 harness checks in-app joining/sharing and verifies that it does not start a server.
