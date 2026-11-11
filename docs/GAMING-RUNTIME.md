# Bundled Windows gaming runtime

Vumiro implements its LAN packet transport, friend signaling, session admission,
screen streaming and controller forwarding inside the application. It uses two
signed Windows driver components to expose the operating system interfaces:

| Component | Version | Purpose | License |
| --- | --- | --- | --- |
| Wintun x64 | 0.14.1 | IPv4 virtual network adapter | [Prebuilt binaries license](../vendor/windows/WINTUN-LICENSE.txt) |
| ViGEmBus | 1.22.0 | Virtual Xbox controller bus | [BSD 3-Clause](../vendor/windows/VIGEMBUS-LICENSE.txt) |

These dependencies are embedded in `Vumiro.exe` and `Vumiro.Updater.exe`.
Starting Gaming does not download another application or send the user to an
external installer page. Windows may show its normal elevation consent prompt
when a gaming feature first needs a driver or virtual network adapter.

The existing updater executable supports `--gaming-host PIPE PARENTPID`. That
mode only accepts a random `VumiroGaming-<32 lowercase hex>` local pipe, checks
its server process ID through Windows, and verifies the parent executable is
`Vumiro.exe` beside the helper. The desktop creates a pipe restricted to its own
user, SYSTEM and elevated administrators, and checks the helper's client process
ID before using it. This also supports a standard Windows user supplying another
administrator's credentials at the Windows authorization prompt.

The IPC protocol accepts heartbeat, LAN start/status/peer updates/packet/stop,
controller status, and controller installation. It accepts no executable paths,
download URLs, shell commands, installer options, or arbitrary adapter addresses.
Messages are UTF-8 JSON lines bounded at 96 KiB; writers are bounded to 128
pending messages and 2 MiB. A 2 second desktop heartbeat refreshes a 30 second
helper lease. Closing the pipe or losing the parent disposes the LAN adapter.

Each embedded payload has a fixed SHA-256 pin in `GamingPayloads.cs`. Extraction
uses a fixed hash directory under `%LocalAppData%/Vumiro/GamingRuntime` or the
elevated helper's `%ProgramData%/Vumiro/GamingRuntime`. Elevated extraction
requires administrator/SYSTEM-owned directories without user write access and
refuses reparse points. The helper hashes extracted bytes before loading the DLL
or starting the installer. Wintun is loaded by an absolute path. The installer
uses only `/exenoui /qn /norestart`, matching its published WinGet manifest. An
existing ViGEmBus service skips installation. A restart-required setup result is
returned to the app instead of restarting Windows.

Payload provenance, archive hash, binary hashes and publisher identities are in
[payloads.json](../vendor/windows/payloads.json). Both downloaded binaries had
valid Windows Authenticode signatures when added. Wintun's archive SHA-256
matches the [official download page](https://www.wintun.net/); the controller
installer hash independently matches the [WinGet manifest](https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/v/ViGEm/ViGEmBus/1.22.0/ViGEm.ViGEmBus.installer.yaml).
The original license notices must accompany distributed binaries.

Native checks run through `tests/GamingHostChecks/GamingHostChecks.csproj` with
an in-memory LAN adapter. They cover restricted actions, pipe naming, bounded
framing/queues, embedded payload hashes, installed-driver setup avoidance, and
session ownership. They do not install a driver, invoke UAC, or establish a real
two-computer connection. Those behaviors require Windows LOCAL QA acceptance.
