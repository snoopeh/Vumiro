# Android first QA build

Date: 2026-11-11. Source baseline: `758fba7`, including the accepted community menu work. Isolated branch: `codex/android-app`. Other checkouts and agents' commits remain untouched.

The user requested an Android version and authorized autonomous implementation. These are implementation assumptions, not additional user approvals.

## Product and architecture

Build an installable Android QA APK using the existing account, friends, direct conversations, community and foreground voice interfaces. Retain the dark/red design, use a four-tab phone navigation bar, and preserve bottom-anchored composers and channel drawers. Package the interface locally so starting the app does not require downloading its UI. Network features continue to use the existing service; do not deploy or change production configuration.

Use a native .NET for Android host with Android WebView. This fits the existing C# repository and shares tested web modules. A fully native UI rewrite would duplicate the feature set; a browser shortcut would lack native secure storage and media permissions. Both are deferred.

Serve an explicit allowlist of packaged resources at `https://vumiro.local/`, an origin already accepted by the backend. Block remote document navigation inside the privileged WebView; open permitted external links in the system browser. Keep signing keys in the existing WebCrypto/IndexedDB implementation. Encrypt saved account sessions using an Android Keystore key, disable app data backup, and fail closed if secure storage is unavailable.

## First-build limits

Email sign-in, signup and account recovery are the first-build authentication paths. Provider browser sign-in needs a separately validated Android return flow. Desktop virtual LAN/controller injection, system audio and screen broadcasting are unavailable on Android. Foreground microphone capture uses explicit Android runtime permissions. Push delivery and background call survival are later work, not capabilities of this build. Do not promise that foreground WebSockets survive Android background suspension.

## Ownership and slices

- [x] Native host: `Vumiro.Android/` except the two mobile UI files; `tests/AndroidHostChecks/`. Test trusted resource routes, message authority and storage envelope handling before implementation. Add lifecycle, Back, permissions, file chooser and external navigation.
- [x] Mobile UI: `Vumiro.Android/Web/mobile-client.js`, `mobile.css`, `tests/android-mobile.test.mjs`. Test navigation, Back and viewport state before implementation. Preserve desktop files.
- [x] Packaging and operation: `scripts/Prepare-AndroidAssets.mjs`, `scripts/Build-Android.ps1`, `tests/android-package.test.mjs`, Android documentation and ignore rules. Test asset selection, bootstrap ordering, notices and deterministic manifests before implementation.
- [x] Integrate: fresh Node/client and native policy tests; compile signed debug APK; inspect package contents and launch on an emulator/device if available. Record actual device availability and observed limitations.
- [x] Review combined diff and commit only this feature's paths. Deliver APK and reproducible build/install instructions. No store upload or production release.

## Acceptance

The APK installs and starts its bundled sign-in screen; mobile navigation is touch sized; Back closes the current overlay or child screen before exiting; Android permissions are requested only for explicit media use; sessions use native encrypted storage; invalid origins and resource paths cannot access the bridge; desktop checks remain passing. Runtime features needing real accounts, devices or networks are reported separately from automated evidence.
