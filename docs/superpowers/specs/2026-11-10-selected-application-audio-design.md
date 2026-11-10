# Selected-application stream audio design

Date: 2026-11-10
Priority: 1C, "Ensure call audio comes exclusively from the selected application"
Status: design proposal; the picker experience needs a user decision before implementation or release signoff

## Problem and release boundary

The Windows host currently starts native audio capture with `excludeDiscord` but no selected source identity. `StreamAudioCapture.Run` discovers every active audio session and mixes every eligible process tree. Discord and Vumiro filtering reduce the mix, but another unrelated application can still reach a peer. The room's `getDisplayMedia()` selection supplies video; it does not give native code the selected Windows process ID. The browser fallback explicitly asks for system audio. Neither path satisfies application-only audio.

Audio isolation is a privacy requirement. Until there is an explicit, verified application choice, start or continue screen video **without a screen-audio track**. The microphone remains a separate, independently controlled track. The UI must state when no application audio is being shared; it must not claim Discord exclusion makes the remaining mix application-only. Do not ship the current broad native mix as application-only audio.

## Approaches and decision

| Approach | Benefit | Cost or limit |
| --- | --- | --- |
| **A. Separate application-audio picker (recommended MVP)** | Reuses the current WebView2 video picker, native process-loopback capture, and RTC audio slot. Explicit source choice can be delivered incrementally. | Users choose video and audio separately. Those choices may differ, so both must be visible during sharing. A process tree can contain more than one window or browser tab. |
| B. Unified native video-and-audio picker | One visible choice can bind HWND, process tree, and video capture from the same native selection. | Requires replacing the `getDisplayMedia()` video path with a Windows.Graphics.Capture pipeline and a browser/WebRTC bridge; substantially more implementation and device QA. Process-tree audio still cannot isolate two windows in one process tree. |
| C. Browser `windowAudio: 'window'` only | Browser may pair a selected window with its audio without a native picker. | The option is a preference the user agent may ignore. Audio can be absent or have a different scope; the app cannot prove isolation from `displaySurface` or `deviceId`. It is unsuitable as the only strict-isolation path. |

**Decision requested from user:** accept separate explicit video and application-audio choices for the 1C MVP, or require a unified native Windows picker before calling 1C complete. If the requirement means a single *window or browser tab* rather than an application's process tree, neither A nor B can promise that generally; scope would require platform-specific window audio support and stronger validation. No choice has been recorded yet.

## Recommended Windows MVP behavior

1. A user begins screen sharing through the existing video picker. Screen audio starts off. If they enable **Share application audio**, open a native-owned picker of currently active output audio applications, with a readable name, icon if safely available, and instance detail where duplicate names exist. Show no arbitrary PID input. Offer **Share video only** and **Cancel**. The choice is deliberate even when a room setting previously enabled audio.
2. The native host records a short-lived, unpredictable selection token scoped to the current top-level page, room/share generation, and chosen process identity. The room iframe requests audio through the trusted friends page; the native host alone resolves the token. JS never gets to nominate a raw PID. Only the currently active room/share may start, stop, or acknowledge that capture.
3. Validate the selected process immediately before activation: PID exists, process creation time and executable identity still match the picker snapshot, the process tree does not contain Vumiro or a protected playback path, and its active audio session is still eligible. Capture the single selected root with `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE` via the existing WASAPI activation path. Do not enumerate and mix unrelated process roots. If the process exits or identity changes, stop and require reselection; never silently follow a reused PID.
4. Show persistent, concise sharing state: **Video: [chosen surface]** where the browser exposes a safe label, **Audio: [chosen application/instance]**, or **Audio: off**. If the video picker cannot expose a reliable surface label, say **Video: selected screen/window** rather than inferring it from audio. If the user picks a browser or multiprocess application, explain that other windows/tabs in the same app process tree can be audible. The existing Discord checkbox should be removed or replaced with a truthful scope description while this single-app mode is active; it cannot filter Discord when Discord itself is the selected app.
5. Keep the existing bounded 48 kHz stereo shared-buffer transport and separate RTC screen-audio sender. Do not connect native audio to local speakers. The native host signals started only after the selected source has been validated and capture has activated. Changing the application tears down the old generation before accepting samples from the new one. Turning off audio, stopping video, leaving the room, navigation, capture failure, or process exit stops capture and removes the outbound audio track. The microphone does not change.
6. On Windows before build 20348, Linux, and ordinary browser hosts, strict application audio is unavailable. Offer video and microphone normally, with screen audio off and a clear capability explanation. Do not fall back to `systemAudio: 'include'` or use a whole-system track under an application-only label. A separately labeled, explicitly consented whole-system mode would be a different feature and needs its own decision.

## Components and trust boundaries

- **Native picker and selection registry:** Native code discovers candidate audio sessions, presents application identities, and issues expiring one-use tokens. It owns the selected process snapshot and share generation. Enumeration is for choice display, never an implicit capture allowlist. Do not persist tokens, PIDs, executable paths, or app names in account sync.
- **Capture source:** Adapt `StreamAudioCapture` from multiple sources and a system mixer to one selected process tree. Keep bounded buffers and device-recovery handling. Recovery may reopen only the same validated process identity; a different process or unknown identity fails closed. A process-root capture covers child processes, so an app with multiple windows can contribute audio from all of them.
- **Native bridge:** Extend the existing trusted friends-page protocol with a picker request and a start command bound to the returned token. Check exact command shapes, origin/frame, current room/share generation, token expiry/consumption, and session ID before starting. The top-level page is a relay; the native host is the authority for process identity. Preserve shared-buffer sequence, acknowledgment, size bounds, and stale-session rejection.
- **Room UI:** Separate the audio app label from the video share label, expose a deliberate reselection action, and handle silent/failed audio without ending video. Keep drafts and Save behavior for persistent stream preferences; each actual application-audio selection remains an immediate, per-share consent action. Do not persist a default process target.
- **Linux host:** Its Electron capture handler currently supplies video only and advertises `systemAudio: false`. Retain that behavior and make the strict-audio explanation consistent across room and settings surfaces.

The release package's Windows file list is fixed for compatibility. Put production logic in existing allowed source/assets where possible; any extra packaged file requires an explicit versioned updater-format plan rather than silently changing the allowlist.

## Failure and security rules

- Fail closed if no candidate is selected, a candidate has ambiguous identity, an audio session disappears, the process identity changes, a token is stale/forged/replayed, a room or share generation changes, a buffer fails validation, or native capture cannot be activated. Continue video and microphone with an actionable status.
- Avoid inferring process identity from window titles, app names, browser track labels, or browser `deviceId`. Labels are display data only. Treat process names and paths as untrusted text when rendering UI or diagnostics.
- The native picker must reject Vumiro and its WebView playback tree. It should not present a broad `all applications` option under the application-only mode. A shared browser/multiprocess tree can still include unrelated tabs; show that limitation before selection and in QA.
- Bound picker candidate count, token lifetime, audio block size, source queue, and retry duration. On temporary device loss, recovery is allowed only for the same validated target; do not switch to a system-wide capture path. Avoid logging audio samples, titles of unrelated windows, private paths, tokens, or peer addresses.
- A source process can start children after selection. Include-tree semantics will capture their audio. The UI promise must be **selected application/process tree**, not **only one window**. If children can host unrelated content, do not make stronger claims.

## Acceptance and verification

**Automated unit/protocol tests**

- Picker candidate filtering and ambiguity handling; only a native selection creates a token. Unknown, expired, reused, mismatched-generation, wrong-origin, and malformed tokens never start capture.
- The capture policy produces exactly one root PID and never falls back to enumerating all active sessions. Process exit, PID reuse, changed creation time/executable identity, and ineligible/protected process stop or reject capture.
- Stale start, stop, acknowledgment, and shared-buffer events cannot affect another share. Stop/reselect clears the old source and outbound RTC track. Unsupported platforms never request `systemAudio: 'include'` in strict mode.
- Device disconnect/reconnect reactivates only the same validated source. Capture failures leave video and microphone running and report audio off.

**Windows native integration gate**

- Run two independent tone-producing processes simultaneously at distinct frequencies. Select A; remote decoded RTP contains A above threshold and B below a strict leakage threshold. Then reselect B and reverse the assertion. Also play Discord and Vumiro room audio locally; neither reaches peers when another application is selected. Test the same scenario with a different default output device and after a device disconnect/reconnect.
- Select an application, terminate it, and start a new process while reusing or simulating the PID. Remote audio becomes silent; no new process is captured until explicit reselection. Cancel the picker and verify silence.
- Exercise video-only, toggling audio while sharing, closing the video source, leaving the room, and an app restart. Verify no stale native capture, no lingering audio RTP track, and no feedback loop.
- Repeat with a browser containing two audible tabs/windows. Record whether both are heard and confirm the UI's process-tree warning is truthful. Human QA must review the picker labels, consent sequence, keyboard navigation, status messages, and local-versus-remote audible behavior.

The existing `NativeAudioSmoke` and `Test-StreamNative.mjs` checks establish positive audio delivery and recovery, but they cannot establish source isolation because they contain no simultaneous unwanted source. Negative isolation is a required signoff gate. The app and release remain pending human review; no deploy or publication is part of this design.

## Official references

- [Microsoft Application loopback audio capture sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/): include or exclude a target process tree through `ActivateAudioInterfaceAsync`; requires Windows build 20348 or later and does not bind audio to a window.
- [W3C Screen Capture specification](https://www.w3.org/TR/screen-capture/): `getDisplayMedia()` requires user choice; audio source may differ from video, `windowAudio` and `systemAudio` are hints, source `deviceId` is not available for selecting a display source, and unrelated system audio requires active consent.
- [Microsoft WebView2 `ScreenCaptureStarting` event args](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2screencapturestartingeventargs): identifies the requesting frame and can gate the browser picker; it does not return the chosen OS process or window.
- [Microsoft `GetWindowThreadProcessId`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid): maps a known HWND to its process ID if a future native video picker is adopted.
- [Microsoft Windows screen capture guidance](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture): native user-selected window/display capture path relevant to the unified-picker alternative.
