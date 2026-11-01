# Vumiro

Share your view. A small Windows app for friends, live screen/voice rooms and direct peer chat.

**[Download Vumiro](https://github.com/snoopeh/Vumiro/releases/latest)** · [User guide](docs/CLIENT.md) · [Architecture](docs/ARCHITECTURE.md) · [Restore point](docs/RESTORE.md)

Extract the Windows package and run **Vumiro.exe**. Windows 10/11 x64, .NET Framework 4.8 and Microsoft Edge WebView2 Runtime are required. No administrator access or local sharing server is needed.

Profiles, signing keys, friends, pictures and settings stay on your device. The Cloudflare Worker handles online discovery, requests and connection signaling. Screen, audio, chat and profile pictures travel directly between peers. Direct connectivity depends on the network; no TURN relay is configured.

Rooms support public access, mutual friends, or a password. Removing and blocking a contact requires confirmation. Short contact codes preserve the existing device identity, and old contact codes remain readable.

## Build

Install the .NET 9 SDK and .NET Framework 4.8 targeting pack on Windows:

```powershell
dotnet build Vumiro.sln -c Release
./scripts/Build-Client.ps1
```

The package is written to `dist/vumiro-1.17.0/`. Only the two desktop projects and six web assets are shipped. The retired capture server, FFmpeg/audio helper, old browser UI and obsolete harnesses are preserved in Git history and the verified restore backup rather than the active tree.

For signaling development, run `npm ci` and `npm run dev` in `cloudflare/`. See [service deployment](cloudflare/README.md).

## Releases and updates

Commit and push a matching `client-v1.17.0` tag to publish the Windows package. Both project versions must match the tag. The app validates package SHA-256, size, permitted files and executable versions before installation; failed file replacement rolls back.

**Older 1.14/1.15 clients need one fresh Vumiro installation after the GitHub repository rename.** Their updater pins the old repository API URL and executable layout. From 1.16 onward, updates use the Vumiro repository and filenames. Existing local profiles and contacts are preserved.

Runtime/streaming tests for this iteration are left to the user as requested. Builds and JavaScript syntax checks do not establish end-to-end behavior or a security audit.

## License

This project continues [Eslam Hamouda's ScreenTask](https://github.com/EslaMx7/ScreenTask), retaining its history and attribution. GPL-3.0-or-later; see [COPYING](COPYING) and [third-party notices](THIRD-PARTY.md).
