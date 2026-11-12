# Android QA validation

Validated on 2026-11-11 in the isolated `Vumiro-Android` checkout. This is implementation readiness for an initial APK, not Android device acceptance or a release.

- `./scripts/Build-Android.ps1`: passed. 25 Android web/bridge/packaging tests, 37 pure native host checks, and a standalone debug APK build with zero warnings/errors.
- `node scripts/Check-Client.mjs --skip-backend --output dist/android/client-checks`: passed. 1,106 client tests passed, zero failures, three existing opt-in checks skipped. Backend and Windows native suites were not repeated: no backend or Windows host source changed.
- APK signature: verified with the Android SDK apksigner (v3 signing).
- Package inspection: both ARM64 and x86-64 include the application managed assembly and Mono runtime; all 58 manifest resources exist in the APK and match their SHA-256 hashes. APK size: 56,494,642 bytes. Notices, privacy information and shared screens are included; no desktop profile was copied.
- Independent reviews found and fixed stopped microphone state, permission-prompt lifecycle and native Back authentication-history defects. Regression tests cover those paths.
- Isolated Windows WebView2 browser rendering: auth, friends, messages, settings, More, community menus/drawer, portrait, landscape and a simulated keyboard resize fit phone viewports. No JavaScript errors or horizontal document overflow were observed. The fixture used synthetic offline profile/account data; it did not exercise real accounts or Android APIs.

Evidence is under ignored `dist/android/`: `build.json`, `package-verification.json`, `signature-verification.log`, `client-checks/checks-report.json`, `logs/` and `render/REPORT.md` with screenshots and geometry captures.

No Android phone was attached. The installed emulator could not boot on this Windows configuration without its hardware-acceleration driver; a software-mode retry also failed. Actual installation/startup, Android Keystore/WebView bridge execution, real account sign-in, microphone permission dialogs, audio routing, IME/insets and background/resume remain physical-device or working-emulator QA items. The APK has not been uploaded to a store or production.
