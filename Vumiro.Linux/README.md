# Vumiro for Linux

The Linux desktop host is packaged as an AppImage, Debian package, and RPM for x64 systems using glibc. It shares the existing friends and room interface while keeping Linux profile data in its own `Vumiro-Linux` user-data directory.

The local interface is served only from the `vumiro://app` origin. Its Electron renderer uses a sandboxed preload bridge for app updates and notifications. Updates are checked against the public Vumiro GitHub releases API; choosing **Download update** opens the matching trusted release page so users can install the package for their distribution.

Microphone capture is supported. Screen video capture asks the desktop portal to choose a source on Wayland and uses an explicit local screen/window picker on X11. Linux system audio capture is not supported. Closing the window hides it to the tray when a tray icon is available; the tray menu and the native application menu both provide **Quit Vumiro**. If the tray cannot be created, closing the window exits normally.
