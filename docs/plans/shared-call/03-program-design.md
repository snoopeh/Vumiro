# Program design

New call.html/call-client.js own browser room behavior; CallSignalingHub.cs owns local signaling; frmMain.Call.cs owns the embedded room and endpoint preferences. Cloudflare files implement the same protocol without a media forwarding API. frame-hold.js retains a transition snapshot only when required, avoiding per-frame 4K canvas work. Build packaging includes WebView2's x64 loader and resolves pinned FFmpeg for development builds.

Validate frame holds and release behavior, existing catch-up/layout/HDR tests, C# signaling isolation and bounds, three browser peers with simultaneous generated video, and embedded WebView loading. Preserve earlier uncommitted changes.
