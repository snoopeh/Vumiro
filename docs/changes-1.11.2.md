# ScreenTask 1.11.2

- Preserve small desktop text with native-resolution, 30 FPS, quality 90 and 20 Mbps defaults. Saved user preferences remain intact.
- Direct WebRTC screen capture requests text detail and keeps resolution when reducing frame rate. Replace its fixed 3 Mbps ceiling with 6/12/20/32 Mbps ceilings for 720p/1080p/1440p/4K sources. Browsers still control actual bandwidth and may ignore unsupported preferences.
- Add persistent **View → Actual size (1:1)** with scrolling to both viewers. Clarify that existing percentage zoom is relative to Fit.
- Make the quality slider control software H.264 compression. Use high-profile, more efficient encoding, bounded constant quality for software and peak-constrained variable bitrate for Media Foundation. Use Lanczos when resizing.

Validation: clean release build; actual encoded small-text fidelity comparison; Chrome/Edge direct connection and decoder/fallback regressions; JPEG/video native-size layout checks; live video/HDR/audio reconfiguration without losing file shares.

Run `node tests/stream-clarity.cjs`, `tests/video-quality.ps1`, `tests/run-connection-tests.ps1`, `tests/run-connection-tests.ps1 -Layout`, and `node tests/live-settings.cjs`. Browser tests need Playwright as described in the README.
