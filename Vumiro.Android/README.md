# Vumiro Android QA

This Android app packages the shared Vumiro interface in a native .NET for Android host. It includes the current community menus and dark/red design, with a phone navigation layer. Desktop source is shared at build time, not forked or downloaded at startup.

This is an early **QA build**, not a store release. Its package ID is `com.vumiro.android.qa`, display name **Vumiro QA**. Minimum Android version is Android 10 (API 29); use an up-to-date Android System WebView. The APK contains ARM64 for phones and x86-64 for emulators. No production credentials or desktop profiles are included.

## Build and install

From the repository root on Windows, with Node.js and .NET 10 installed:

```powershell
./scripts/Build-Android.ps1 -InstallDependencies
```

This installs the Android workload, Microsoft OpenJDK and Android SDK dependencies if needed, runs Android web and host policy tests, prepares shared assets and builds a standalone debug-signed APK. Later builds can omit `-InstallDependencies`. Override `-AndroidSdkDirectory` and `-JavaSdkDirectory` for existing installations. Default paths are `%LOCALAPPDATA%/Android/Sdk` and `%LOCALAPPDATA%/Microsoft/OpenJDK`; `ANDROID_HOME` and `JAVA_HOME` take precedence.

The deliverable is `dist/android/Vumiro-Android-QA.apk`; its SHA-256, source revision and working-tree state are recorded in `dist/android/build.json`. Logs are under `dist/android/logs`. Generated web assets under `Assets/Web` are ignored. The preparer rejects unexpected generated files rather than shipping stale files or local data.

For a USB-debugging-enabled phone or an already running emulator:

```powershell
./scripts/Build-Android.ps1 -Install -DeviceId YOUR_ADB_DEVICE_ID
```

Alternatively, transfer the APK to your Android phone and open it, allowing installation from the app used to open the file. This is a local debug build. Do not replace or share its signing key as a production key. No Play Store publishing is configured.

## What to try

- Email sign-in, account creation, email verification and account recovery. Restore your existing identity through the existing encrypted account recovery flow; do not copy browser data or signing files.
- Friends, direct conversations, community/channel menus and themes, and foreground microphone voice with Android permission prompts.
- Phone tabs, conversation/list Back navigation, community channel drawer, dialogs, portrait/landscape and keyboard visibility. The composer should remain reachable while typing.
- Restart the app and verify session restoration. Sign out and verify the account session is removed from native storage.

Online features use Vumiro's existing backend. Locally packaged screens do not make online sign-in, chat or voice work offline. Local community previews remain clearly labeled simulations.

## First-build boundaries

Browser provider sign-in is not enabled in this build; email sign-in and recovery remain available. Android screen broadcasting, desktop system audio, virtual LAN and desktop controller injection are unavailable. Foreground voice is the initial target; there is no background calling service or push notification delivery. Android may suspend network activity when the app is backgrounded. Physical microphone, Bluetooth routing, permissions, authentication and background behavior need real-device QA before release.

## Storage and trust boundary

Packaged assets are served only from the allowlisted `https://vumiro.local` origin, which is already accepted by the Vumiro service. External web pages open in the system browser and never receive the native bridge. The bridge checks source origin, frame authority, message shape and operation allowlists. WebView file/universal access is disabled. Backup of app data is disabled.

P-256 signing keys stay in the existing WebCrypto/IndexedDB identity store. Saved account-session data is encrypted with AES-GCM using an Android Keystore key, stored in the app's no-backup directory. There is no plaintext fallback when secure storage fails. This storage is separate from signing-key/account recovery.

The package contains `COPYING`, third-party and font notices, privacy information and a source notice. Supply the matching source checkout/archive with any QA binary distribution.
