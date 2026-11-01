# Restore stream audio and Discord exclusion

User requests restoration from Git history; Luna implementation, no runtime tests. Standing autonomy overrides skill approval gates. Preserve the current six-asset Windows updater contract and local identities.

## Findings and behavior

Legacy helper/server introduced in 5eb6e5d and removed in 6c09f62. The old feature excluded a process tree from captured audio; it did not mute local Discord playback. Existing RTC has separate screen video, screen audio and microphone slots. Browser getDisplayMedia audio is optional and cannot provide app exclusion.

Restore reliable Windows system audio using an embedded net48 WASAPI process-loopback capture path. Exclude Vumiro/WebView playback always, optionally exclude Discord (default on). Enumerate local output audio sessions periodically, include eligible process trees without duplicate ancestor capture, mix bounded float stereo 48 kHz blocks. No Cloudflare audio requests, local web server, new updater assets or executable helper. Unsupported Windows builds retain browser capture with accurate capability copy; Linux system audio remains unavailable in this release.

## Bridge

Only the trusted top-level friends page talks to native code. Parent verifies source and origin for room messages; native verifies its existing main-page source guard. Commands:

- `{type:'stream-audio',action:'state'}`; reply adds `supported`, `sampleRate:48000`, `channels:2`.
- `{type:'stream-audio',action:'start',id,excludeDiscord}`; reply `action:'started'`, matching id and format.
- `{type:'stream-audio',action:'stop',id}`; reply `action:'stopped'`, matching id.
- `{type:'stream-audio',action:'ack',id,sequence}` bounds native delivery to one in-flight buffer plus the latest pending block.
- Errors: `{type:'stream-audio',action:'error',id,message}`.

Native posts read-only WebView2 shared buffers with metadata `{type:'stream-audio',action:'samples',id,sequence,sampleRate:48000,channels:2,frames:1920}`. The parent copies/releases the native buffer, transfers the PCM ArrayBuffer to the current room and acknowledges. Session ids and generations reject stale commands/data; stop on sharing off, room departure, navigation, actual exit or capture failure. Close-to-tray preserves active capture.

Room creates a Web Audio MediaStreamDestination consumed by RTC screen-audio slot. Never connect it to local speakers. Use bounded playback scheduling; stop/disconnect old sources and reject stale events. Microphone stays independent. Enabling audio during sharing starts capture; excluding Discord can be changed live. Browser fallback does not promise native exclusions.

## Ownership and verification

- linux_host: new native capture C# class/support only.
- room_polish: four existing shared UI/RTC assets only.
- Root: native WebView bridge, Program integration, versions/docs, static/build/package, Git/release/deploy.

Version 1.21.0 across Windows app/updater and Linux package. Compile, syntax and packaging checks only; no app launch or runtime tests. Rebuild/publish both platforms together; deploy matching six static service assets.

Primary references: Microsoft Windows ApplicationLoopback classic sample (build 20348+), WebView2 PostSharedBufferToScript and JavaScript sharedbufferreceived/releaseBuffer APIs.
