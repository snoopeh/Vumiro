# Vumiro

Share your view. A Windows and Linux app for friends, live screen/voice rooms and direct peer chat.

**[Download Vumiro](https://github.com/snoopeh/Vumiro/releases/latest)** · [User guide](docs/CLIENT.md) · [Architecture](docs/ARCHITECTURE.md) · [Restore point](docs/RESTORE.md)

Extract the Windows package and run **Vumiro.exe**. Windows 10/11 x64, .NET Framework 4.8 and Microsoft Edge WebView2 Runtime are required. No administrator access or local sharing server is needed.

For Linux x64, download **Vumiro-linux-x64.AppImage**, **.deb** or **.rpm** from the same release. Debian/Ubuntu and Fedora/openSUSE packages integrate with the desktop; AppImage is the portable option for other common glibc distributions. See the [Linux guide](docs/LINUX.md) for installation and desktop requirements. Linux uses its own local device profile and can join the same rooms as Windows clients.

Local profiles, signing keys, friends, pictures and settings stay on your device. Optional email/password accounts can sync profile and contact data through the account service; recoverable signing identities are encrypted in the client. The Cloudflare Worker also handles online discovery, requests and connection signaling. Screen, audio, room chat and peer profile-picture transfers travel directly between peers. Friend direct messages use signed, server-readable durable mailboxes so offline friends can receive them after reconnecting; see [direct messaging](docs/DIRECT-MESSAGES.md). Direct connectivity depends on the network; no TURN relay is configured.

The connection service is **https://vumiro-rooms.vumiro-signaling.workers.dev**. Update to 1.21.1 or newer to use the renamed service. Existing saved production URLs and room invitations migrate automatically; your profile, friends and custom service settings remain intact.

Rooms support public access, mutual friends, or a password. Removing and blocking a contact requires confirmation. Short contact codes preserve the existing device identity, and old contact codes remain readable.

Signed room text now has a local archive, with optional [self-hosted SQLite backup](storage/README.md). **Settings → Data & servers** selects local/private storage and creates initial server/channel records. **Servers** opens a [local sandbox](docs/SERVERS.md) with saved text channels, drafts, member previews and basic management. Its demo presence and voice layouts are simulated; shared community-server delivery and attachment-file archives remain future work. Friends management and Conversations have separate destinations. **Appearance & startup** controls the cold-launch intro; **Support Vumiro** above the sidebar profile is ready for the owner's [PayPal link setup](docs/SUPPORT.md).

Windows 11 stream audio uses native application capture, with Discord excluded by default while remaining audible locally. Vumiro's room playback is excluded to prevent feedback. Microphone and stream-audio controls are separate. Older Windows versions use browser-provided audio where available; Linux system-audio capture is not included yet. See the [audio guide](docs/CLIENT.md#stream-audio-on-windows).

## Build

For local human QA, double-click **Local QA.cmd** or run `./scripts/Run-Local.ps1`. The native app uses an isolated profile and live source assets; **Reload UI** picks up web edits without publishing a release. See [local development](docs/LOCAL-DEVELOPMENT.md).

Install the .NET 9 SDK and .NET Framework 4.8 targeting pack on Windows:

```powershell
dotnet build Vumiro.sln -c Release
./scripts/Build-Client.ps1
```

The package is written to an explicit output directory such as `dist/vumiro-1.21.8/`. Only the two desktop projects and shared web assets are shipped. The retired capture server, FFmpeg/audio helper, old browser UI and obsolete harnesses are preserved in Git history and the verified restore backup rather than the active tree.

Build the Linux packages on a Linux x64 host with Node.js 22 or later, `rpm` and `libarchive-tools` installed:

```sh
cd Vumiro.Linux
npm ci
node ../scripts/Build-Linux.mjs
```

Linux packages and `SHA256SUMS-linux.txt` are written to `dist/linux-release/`. GitHub Actions builds them on Ubuntu and runs an offline startup/UI smoke test against the packaged app under Xvfb. Ordinary source pushes use an unpacked build instead of producing distribution archives.

For signaling development, run `npm ci` and `npm run dev` in `cloudflare/`. See [service deployment](cloudflare/README.md).

## Releases and updates

Use LOCAL QA during development. After human QA is accepted, commit/push the source and preview `./scripts/Ship.ps1 -Bump patch`. When asked to release, append `-Publish -QaAccepted`; the command aligns versions, creates the release commit/tag and pushes atomically. CI builds both platforms, verifies a private draft, publishes it, then checks downloads and updater discovery. See [release commands, checks and reports](docs/RELEASING.md).

The Windows app automatically checks and installs available updates at startup before the interface becomes interactive. It validates package SHA-256, size, permitted files and executable versions before installation. Windows runs one instance per local profile, restores its existing window on another launch, and checks for older copies before updating. The updater prepares all changed files and recovery copies before committing atomic replacements; a failed commit rolls back completed replacements and reports its filename and cause. A recovery restart skips automatic installation once so a failed update cannot cause a restart loop. Diagnostic logs are written under `%LOCALAPPDATA%\Vumiro\Updates`. LOCAL QA does not install updates. Linux checks for releases and opens the download page for manual package installation.

**Older 1.14/1.15 clients need one fresh Vumiro installation after the GitHub repository rename.** Their updater pins the old repository API URL and executable layout. From 1.16 onward, updates use the Vumiro repository and filenames. Existing local profiles and contacts are preserved.

Real account, peer networking and screen/audio acceptance remain part of human QA. Automated startup and UI smoke checks cover selected regressions; they do not establish every end-to-end flow or constitute a security audit.

## License

This project continues [Eslam Hamouda's ScreenTask](https://github.com/EslaMx7/ScreenTask), retaining its history and attribution. GPL-3.0-or-later; see [COPYING](COPYING) and [third-party notices](THIRD-PARTY.md).
