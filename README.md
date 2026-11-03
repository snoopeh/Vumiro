# Vumiro

Share your view. A Windows and Linux app for friends, live screen/voice rooms and direct peer chat.

**[Download Vumiro](https://github.com/snoopeh/Vumiro/releases/latest)** · [User guide](docs/CLIENT.md) · [Architecture](docs/ARCHITECTURE.md) · [Restore point](docs/RESTORE.md)

Extract the Windows package and run **Vumiro.exe**. Windows 10/11 x64, .NET Framework 4.8 and Microsoft Edge WebView2 Runtime are required. No administrator access or local sharing server is needed.

For Linux x64, download **Vumiro-linux-x64.AppImage**, **.deb** or **.rpm** from the same release. Debian/Ubuntu and Fedora/openSUSE packages integrate with the desktop; AppImage is the portable option for other common glibc distributions. See the [Linux guide](docs/LINUX.md) for installation and desktop requirements. Linux uses its own local device profile and can join the same rooms as Windows clients.

Local profiles, signing keys, friends, pictures and settings stay on your device. Optional email/password accounts can sync profile and contact data through the account service; recoverable signing identities are encrypted in the client. The Cloudflare Worker also handles online discovery, requests and connection signaling. Screen, audio, chat and peer profile-picture transfers travel directly between peers. Direct connectivity depends on the network; no TURN relay is configured.

The connection service is **https://vumiro-rooms.vumiro-signaling.workers.dev**. Update to 1.21.1 or newer to use the renamed service. Existing saved production URLs and room invitations migrate automatically; your profile, friends and custom service settings remain intact.

Rooms support public access, mutual friends, or a password. Removing and blocking a contact requires confirmation. Short contact codes preserve the existing device identity, and old contact codes remain readable.

Windows 11 stream audio uses native application capture, with Discord excluded by default while remaining audible locally. Vumiro's room playback is excluded to prevent feedback. Microphone and stream-audio controls are separate. Older Windows versions use browser-provided audio where available; Linux system-audio capture is not included yet. See the [audio guide](docs/CLIENT.md#stream-audio-on-windows).

## Build

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

Linux packages and `SHA256SUMS-linux.txt` are written to `dist/linux-release/`. GitHub Actions builds them on Ubuntu; no Linux desktop or runtime test is launched by the build.

For signaling development, run `npm ci` and `npm run dev` in `cloudflare/`. See [service deployment](cloudflare/README.md).

## Releases and updates

Commit and push a matching `client-v1.21.8` tag to publish the Windows and Linux packages after both builds pass. Both Windows project versions and the Linux package version must match the tag. The Windows app validates package SHA-256, size, permitted files and executable versions before installation. Windows runs one instance per local profile, restores its existing window on another launch, and checks for older copies before updating. The updater prepares all changed files and recovery copies before committing atomic replacements; a failed commit rolls back completed replacements and reports its filename and cause. Diagnostic logs are written under `%LOCALAPPDATA%\Vumiro\Updates`. Linux checks for releases and opens the download page for manual package installation.

**Older 1.14/1.15 clients need one fresh Vumiro installation after the GitHub repository rename.** Their updater pins the old repository API URL and executable layout. From 1.16 onward, updates use the Vumiro repository and filenames. Existing local profiles and contacts are preserved.

Runtime/streaming tests for this iteration are left to the user as requested. Builds and JavaScript syntax checks do not establish end-to-end behavior or a security audit.

## License

This project continues [Eslam Hamouda's ScreenTask](https://github.com/EslaMx7/ScreenTask), retaining its history and attribution. GPL-3.0-or-later; see [COPYING](COPYING) and [third-party notices](THIRD-PARTY.md).
