# Gaming

Gaming in the main menu contains **LAN tunneling**, **Game together**, and **Controller mappings**. Native connection and virtual-controller actions currently require the Windows desktop app. Other clients can edit, import and export mapping profiles, and show an explicit Windows requirement for native operations.

## LAN tunneling

Install [ZeroTier](https://www.zerotier.com/download/) on each PC. Create a **private** network in [ZeroTier Central](https://my.zerotier.com/), share its 16-character network ID, and use **Join network** in Vumiro. The network owner authorizes each PC in Central. Vumiro shows the service state, memberships, authorization status, assigned addresses and peer routes. Copy connection details to share with a friend in chat; start the game's LAN mode and use the host's assigned address. Game discovery broadcasts, firewall permissions and LAN support depend on the game and ZeroTier network configuration.

The native adapter uses ZeroTier's authenticated loopback API. Its machine token never enters JavaScript, profile exports, account sync or diagnostic messages. If the token requires administrator access, Vumiro reports that explicitly; it does not elevate or weaken file permissions. Leaving a network changes only this PC's membership. Network creation and member approval stay in Central.

## Game together

Install [Sunshine](https://docs.lizardbyte.dev/projects/sunshine/latest/) on the game host and [Moonlight](https://moonlight-stream.org/) on the joining PC. Set up Sunshine credentials and controller support. Enter the host's LAN address in Vumiro, choose **Pair with PC**, and approve the PIN through Sunshine. **Start remote play** launches Moonlight's **Desktop** stream. It acknowledges launching the client, and does not claim the host accepted or that a stream connected. If the host removed its Desktop application, add that application in Sunshine or choose the game in Moonlight directly.

Sunshine/Moonlight provide encoding, streaming, pairing, authorization and controller forwarding. Vumiro does not bundle those programs or implement its own transport. Both players need a game with local multiplayer, and the remote controller must occupy a separate player slot. A normal controller can pass directly through Moonlight; choose **Physical controller** to stop keyboard conversion. A compatible virtual-controller backend is also required on the Sunshine host. Use private LAN access; Vumiro does not expose Sunshine configuration to the internet.

## Controller mappings

Click any input on the themed controller diagram or its binding, then press a supported key. WASD defaults to the left stick, arrows to the right stick, Space to A, and Shift/Ctrl to triggers. Keys must be unique; clear a previous binding before reassigning it. Opposite directions cancel and diagonal stick input stays within the maximum analog radius. Digital keys produce digital/full-scale stick and trigger values, rather than pressure-sensitive analog input.

Save up to 20 profiles on this device, export a bounded JSON profile, or import a validated profile. Saving errors are visible; invalid imports never replace existing mappings. **Start mapper** creates a real virtual Xbox 360 controller through the optional ViGEmBus driver. Moonlight detects that controller locally and sends its state to Sunshine. Native mapped-key capture is restricted to the discovered installed Moonlight executable. Vumiro's diagram provides an in-app preview while normal text entry remains available. Escape is reserved for an emergency stop in Moonlight or Vumiro. Focus changes release all controls, and keys already held across a focus transition require a release and fresh press before being mapped again. Leaving Gaming, selecting physical input, navigating/reloading, closing the app, or missing the heartbeat stops the mapper and removes the virtual device.

[ViGEmBus is end of life](https://docs.nefarius.at/projects/ViGEm/End-of-Life/). Vumiro exposes it as a free compatibility backend, does not install its driver automatically, and accurately reports absent/incompatible drivers. The pinned MIT managed client (including its upstream native client resources) is embedded in Vumiro.exe to preserve the existing updater package format. Sunshine also has [other controller backends](https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2configuration.html) with separate licensing and compatibility requirements.

## Verification

Run `node scripts/Check-Client.mjs --group gaming --native --skip-backend` for the feature's JavaScript, package/localization consumers and native adapter/controller/dependency checks. `tests/GamingControllerChecks/bin/Debug/net48/GamingControllerChecks.exe --integration` explicitly tests creating and removing an actual XInput device when ViGEmBus is installed; it never injects physical keys. The ordinary checks do not join a network, pair with another PC, launch a game, or install software.

Two-PC LAN play, remote video/audio, game player assignment, Steam recognition on the host and latency still require human QA with those PCs and providers. No release or provider deployment is part of adding this source.
