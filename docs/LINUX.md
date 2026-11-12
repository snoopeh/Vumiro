# Vumiro on Linux

The Linux x64 client shares Vumiro's friends, rooms, voice, screen video and direct chat with the Windows client. Download packages from [GitHub Releases](https://github.com/snoopeh/Vumiro/releases/latest).

## Install

- **Debian, Ubuntu and Linux Mint:** install `Vumiro-linux-x64.deb` through the package manager, or run `sudo apt install ./Vumiro-linux-x64.deb` from its download folder.
- **Fedora and related RPM desktops:** install `Vumiro-linux-x64.rpm` using the package manager, for example `sudo dnf install ./Vumiro-linux-x64.rpm`. On openSUSE use its package installer.
- **Other common glibc distributions:** make `Vumiro-linux-x64.AppImage` executable (`chmod +x Vumiro-linux-x64.AppImage`) and run it. AppImage may require the distribution's FUSE compatibility package; the native deb/rpm package avoids this requirement.

This release targets 64-bit x86 Linux. ARM, Alpine/musl and every desktop/distro combination are outside the initial package scope. Native packages are preferable where AppImage support or Chromium's sandbox is restricted by the distribution. The app does not disable Chromium's sandbox or need a local sharing server.

Verify downloads using the accompanying `SHA256SUMS-linux.txt`, for example `sha256sum -c SHA256SUMS-linux.txt` after downloading all three listed packages.

## Screen sharing and sound

On Wayland, use a working PipeWire and xdg-desktop-portal installation with the backend for your desktop. The desktop's sharing dialog chooses the screen/window. On X11, Vumiro shows its own screen/window selection dialog. Cancelling either dialog leaves sharing off.

The microphone remains separate from screen sharing. This release supports screen video and microphone audio, but not Linux system-audio loopback; its screen-audio controls are disabled rather than promising unavailable audio. These behaviors follow Electron's [capture API](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts) and [PipeWire capture behavior](https://www.electronjs.org/docs/latest/api/desktop-capturer#linux).

## Window, tray and profile

Vumiro uses the native Linux window frame. Close hides the app to the tray where available, leaving the room connected. Use its tray menu to reopen or quit; launching Vumiro again restores the running instance. The app menu and Ctrl+Q also quit. Some desktops, including GNOME configurations without an indicator extension, may not display tray icons.

Profiles and signing keys stay in the Linux user's Vumiro application data directory. Linux creates a separate device identity from an existing Windows installation. Keep using the same Linux user-data directory to preserve that identity and its friends; no Windows profile is overwritten or uploaded.

## Updates and validation

For account keyring errors, certificate trust failures, and remote QA builds, see [Linux environment QA](LINUX-ENVIRONMENT-QA.md).

Updates checks GitHub on startup or when requested; Download update opens the trusted release page. Install the new deb/rpm/AppImage manually while preserving your user data. This first Linux release does not run the Windows updater or replace Linux executables in the background.

Packages are built on Linux in CI. Runtime validation of Wayland/X11 capture, microphone, tray integration and distro-specific permissions remains with the user, as requested.
