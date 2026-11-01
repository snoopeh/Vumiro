# Vumiro 1.21.0

- Restores native Windows stream audio from the functionality preserved in the legacy Git history.
- Restores Discord exclusion: The Discord desktop app remains audible locally while its audio is omitted from the stream.
- Excludes Vumiro/WebView playback from native stream audio to prevent room feedback.
- Keeps microphone audio independent; stream sound and Discord filtering can change while sharing.
- Uses embedded capture and bounded shared-memory delivery without restoring the old local server or shipping extra update helpers/dependencies.

Native audio requires Windows build 20348+ (including Windows 11). Earlier Windows versions retain browser audio where available. Linux system audio remains unavailable. Compilation and package checks are performed; runtime audio/capture testing remains with the user.
