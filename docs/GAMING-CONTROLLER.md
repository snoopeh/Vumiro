# Keyboard controller mapping

Vumiro creates a local Xbox 360 controller through the optional ViGEmBus driver. Moonlight can forward that controller into a Sunshine stream. Native keyboard capture runs while the installed Moonlight streaming window has focus; Vumiro itself previews keys without suppressing them. A physical controller can be used directly in Moonlight without enabling this keyboard mapper. The streaming host also needs whatever controller driver its installed Sunshine version requires.

The mapper uses [Nefarius.ViGEm.Client 1.21.256](https://www.nuget.org/packages/Nefarius.ViGEm.Client/1.21.256), a .NET Standard 2.0 package compatible with the net48 Windows host. The [official ViGEm end-of-life statement](https://docs.nefarius.at/projects/ViGEm/End-of-Life/) says the bus and client libraries are retired and receive no further updates. This is an explicit optional compatibility backend. Vumiro never installs a driver automatically or reports an enabled controller when initialization failed. [Official client sources](https://github.com/nefarius/ViGEm.NET) describe the virtual-controller API.

## Controls and profiles

The browser module `controller-mapping.js` exports `window.VumiroControllerMapping` (and CommonJS exports for tests):

- `DEFAULT_BINDINGS`: WASD left stick, arrow keys right stick; Space/E/R/F face buttons; Q/C shoulders; left Shift/Control triggers; Tab/Enter back/start; Z/X stick clicks; 1–4 D-pad.
- `validateBindings(object)`: returns `{valid, errors, bindings}`. Profiles may leave controls unbound with an empty string. Unknown controls, unsupported codes and duplicate key assignments fail validation. Escape is reserved for stopping.
- `frameFromKeys(bindings, Set<KeyboardEvent.code>)`: returns `{buttons,leftX,leftY,rightX,rightY,leftTrigger,rightTrigger}`. Buttons use XUSB flags; sticks use signed 16-bit values and radial normalization; triggers use 0–255. Opposite directions cancel, including D-pad directions.

The native mapper validates independently using the same control/code whitelist. Scan codes preserve physical letter positions across keyboard layouts. Profile persistence and import/export belong to the gaming UI; native capture receives a validated snapshot when started.

## Native bridge

Actions use the existing trusted-origin gaming request envelope:

| Action | Fields | Result |
| --- | --- | --- |
| `mapper-status` / `controller-status` | none | `{ok,controller}` |
| `mapper-start` | `bindings: {target: KeyboardEvent.code}` | `{ok,error,controller}` |
| `mapper-stop` | none | Neutralize controls, remove device, `{ok,controller}` |
| `mapper-heartbeat` | none | Renew lease, `{ok,controller}` |

`controller` contains `available`, `active`, `capturing`, `backend: "ViGEmBus"` and `message`. `available` records bus connection readiness; successful creation of both a virtual device and keyboard hook is required for `active`. `capturing` requires an allowed foreground window. Unknown actions return null to the owning bridge.

The UI sends a heartbeat every second. The independent native report loop stops and disconnects after five seconds without one. The mapper runs a low-level keyboard hook and reports on a dedicated thread. It suppresses only bound physical keys while the foreground process is the exact installed Moonlight executable resolved by the native service **and** the window has class `SDL_app` and a title ending ` - Moonlight`. These identify the [SDL streaming window in Moonlight's source](https://github.com/moonlight-stream/moonlight-qt/blob/master/app/streaming/session.cpp); [SDL's Windows backend](https://github.com/libsdl-org/SDL/blob/SDL2/src/video/windows/SDL_windowsevents.c) defines that class. Moonlight's Qt settings, Add PC dialogs, Vumiro's own forms and text inputs retain normal keyboard input. Unknown future window formats leave capture disabled. Software-injected keys are ignored. Process-image and window-metadata lookup stay outside the keyboard callback. Windows shortcuts and Alt+Tab/Alt+F4 pass through when their modifiers have not themselves been rebound.

Every foreground-window transition clears held state; new presses in a recognized Moonlight streaming window resume mapping. Auto-repeat from a key held during the transition stays neutral until it is released and pressed again. Focus on another app or a Moonlight settings dialog leaves the device neutral and passes keys through. Escape in Vumiro or Moonlight is an emergency stop. Stopping, navigation/disposal, expired heartbeat, hook/report errors and device removal release controls and disconnect the controller. The driver may be unable to receive a final neutral report after physical removal; teardown still attempts disconnection.

## Verification and manual acceptance

Run `node --test tests/controller-mapping.test.mjs`, then build and run `tests/GamingControllerChecks/GamingControllerChecks.csproj`. The native console checks mapping, independent validation, scan-code translation, focus release, shortcut recognition, invalid starts and inactive readiness reporting. The default run does not install a driver or create a virtual device. Passing `--integration` to its executable briefly creates real virtual Xbox controllers and verifies their connection/removal through Windows XInput, explicit stop, restart and the five-second heartbeat expiry. This optional integration requires an installed working ViGEmBus and a free XInput slot.

On the development machine, both the default checks and real ViGEmBus/XInput integration passed on 2026-11-10. An isolated copy of the native check executable without `Nefarius.ViGEm.Client.dll`, run with `--missing-client`, also verified unavailable status and failed startup without an unhandled exception. These checks establish actual driver/device lifecycle behavior, but do not synthesize physical keyboard presses or establish remote gameplay acceptance.

Hardware acceptance still requires a machine with ViGEmBus: start mapping; inspect sticks/buttons in Windows game-controller properties; hold/release diagonal directions; switch to another app while holding a key; resume with fresh key presses in Moonlight; check Escape; interrupt heartbeats; close Vumiro; remove the driver/device. Verify the controller releases/disappears in each stopping case and Moonlight delivers a separate player controller to a compatible local multiplayer game.
