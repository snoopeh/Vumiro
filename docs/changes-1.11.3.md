# ScreenTask 1.11.3

Keep the stream synchronized during long viewing sessions:

- Check playback every 250 ms, including when no new fragment is being appended and when returning to a visible browser tab.
- Skip stale buffered frames when more than 0.8 seconds behind; target about 0.2 seconds from the latest received video. Preserve deliberate pauses.
- Apply the same policy to native HDR decoding before it forwards frames to direct WebRTC viewers.
- Bound browser decoder queues and restart H.264 near live on backlog rather than switching a healthy decoder to JPEG.
- Bound server video queues and writes so slow connections reconnect instead of retaining stale output.
- Request minimal jitter buffering for supported WebRTC audio/video receivers. Browser and network buffering still affect overall latency.

Tests cover threshold/no-append behavior, disjoint buffered ranges, pauses and cleanup, real browser playback rewind/catch-up, native HDR forwarding, and slow server writes.
