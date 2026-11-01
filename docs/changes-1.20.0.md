# Vumiro 1.20.0

- Adds a Linux x64 desktop client with AppImage, deb and rpm packages.
- Reuses the current friends, room, chat, avatar and reliable request interface with Windows interoperability.
- Adds native Linux window controls, close-to-tray, single-instance reopening and a restricted Electron desktop bridge.
- Adds explicit screen selection for X11 and PipeWire/portal selection for Wayland, with separate microphone access. Linux system-audio loopback is unavailable and its controls are disabled.
- Linux update checks open the release page for manual installation. Windows retains its existing updater.
- The service permits the Linux client's exact local origin; its existing signaling and media architecture is unchanged.

Linux profiles are separate device identities. Package builds and static checks do not establish runtime compatibility with every Linux desktop; runtime testing remains with the user.
