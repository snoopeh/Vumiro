# Linux desktop support

User-authorized autonomous implementation; Luna agents; no runtime tests or app launches. Compile/package and CI packaging are permitted. Support common glibc Linux x64 desktops with AppImage, Debian/Ubuntu .deb and Fedora/openSUSE .rpm. No macOS, ARM64 or musl promise in this first release.

## Architecture

Add Vumiro.Linux, an Electron host sharing the six existing WebServer assets copied at build time. Keep the Windows WinForms/WebView2 host, identity origin and updater asset layout unchanged. Version1.20.0 across app projects and Linux package. Pin verified current npm versions Electron45.2.1 and electron-builder26.18.0 with a lockfile.

Register `vumiro` as a standard secure scheme before ready; local UI origin `vumiro://app`. Serve an exact asset allowlist through protocol.handle, with MIME/CSP/security headers; never serve arbitrary file paths. In Node, validate URL.protocol and hostname (custom URL.origin is null in Node). Worker permits exact WebSocket Origin `vumiro://app`. Linux profile is stable under its own user-data directory, independent of Windows identities.

Renderer sandbox/contextIsolation=true, nodeIntegration=false, no webviews or remote scripts. Deny remote navigation/window creation; only main-process trusted release URL opens externally. Single-instance launcher restores the running window. Use native Linux window frame and resizing, avoiding custom Windows drag/resize IPC.

## Bridge contract

preload exposes `window.vumiroDesktop` with:
- platform:'linux'
- capabilities:{nativeWindowFrame:true,systemAudio:false,manualUpdates:true}
- postMessage(message): narrow window/updates actions only
- addEventListener('message',callback): callback receives {data:state}; never exposes IPC event or generic IPC channels.

Shared JS chooses window.vumiroDesktop || window.chrome?.webview. Existing window-state/updates event shapes retained; validate IPC sender's exact main frame and friends.html URL in main. Linux window state backdrop:false. Native Linux titlebar means hide shared HTML titlebar/resize edges and expand .app to full viewport with a desktop-linux class.

## Capture and tray

Permission handlers permit only trusted local frames, audio microphone (no camera) and necessary clipboard writes. Display capture requires trusted call frame, user gesture, video requested. Wayland/PipeWire getSources presents the portal picker; accept its one explicitly selected source or cancel safely. On X11, show a local modal source picker listing screens/windows; never silently choose the first source. Host-specific picker files remain in Vumiro.Linux and are not added to Windows assets.

Microphone and screen video supported; system audio loopback unsupported on Linux in this release. Disable screen-audio controls and explain this in Linux UI; pass platform=linux into room iframe query so capture settings enforce audio:false. Do not affect Windows/browser audio settings.

X/Alt+F4 hide to tray when tray constructed; Open/Quit tray menu, launch again restores via single-instance lock, Ctrl+Q/menu quits. Keep WebView alive/backgroundThrottling:false, no suspension; allow updates/OS shutdown actual exit. Native menu provides Quit even on desktops lacking tray extension. Startup local red spinner until shared page ready, no frozen overlay. Fallback to real close if tray cannot be created.

## Updates and packaging

Linux update bridge checks trusted public GitHub release metadata on startup/user action only; no polling. Download update opens the fixed release page for manual package installation, not Windows updater or arbitrary executable URLs. Update copy/button differs on Linux. Windows updater remains intact and finds its exact Windows asset in a multi-platform release.

package.json build config includes Linux AppImage/deb/rpm x64, stable appId/product/executable, copied shared assets, app icon and license notices. Build on ubuntu-22.04 CI (Linux host unavailable locally; WSL not installed). Workflow builds Windows and Linux in separate jobs, uploads both, then a single publisher creates the tagged release to avoid races. Preserve Windows SHA256SUMS.txt; Linux checksums use SHA256SUMS-linux.txt. Linux asset names Vumiro-linux-x64.AppImage, Vumiro-linux-x64.deb, Vumiro-linux-x64.rpm. Build workflow compiles Linux packaging without launching app/tests. No Electron Windows replacement needed.

## Ownership

- linux_host: Vumiro.Linux host/preload/picker JS/HTML and host README only, excluding package/build scripts/resources.
- linux_packaging: Vumiro.Linux/package.json/package-lock.json, build/prepare-assets and resource scripts, .github workflows, scripts/Build-Linux.mjs, .gitignore.
- shared_linux: friends-client.js, friends.html, call-client.js only.
- Root: Worker Origin allowlist, versions/docs/release/deploy, icon resource assistance, integration review and CI.

Official references: Electron session/displayMediaRequestHandler, desktopCapturer PipeWire caveat, protocol secure schemes, sandbox/security docs. System picker option useSystemPicker is macOS-only; Linux portal is triggered by getSources, not that option.
