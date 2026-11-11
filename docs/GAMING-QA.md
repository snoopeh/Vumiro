# Private gaming QA kit — LOCAL QA only

This folder is a private Debug build of Vumiro with isolated profiles and a visible LOCAL QA badge. No release, version change, production deployment or account migration is required. The installed Vumiro app and its profile stay separate. Normal release builds do not enable the native self-test bridge.

## Build the kit (developer computer)

From this checkout run `./scripts/New-GamingQaKit.ps1`. The builder needs the .NET SDK / .NET Framework 4.8 targeting pack, Node, and npm. It runs focused checks, builds Debug, and copies the app, web assets and current signaling Worker. The first build runs `npm ci` for the private relay; only the builder needs that download. A Node executable, its matching official license (downloaded on the builder if absent locally), Miniflare/workerd, Wrangler and their installed package licenses are copied into the kit so testers need neither Node nor npm installed. Output goes into a new `dist/gaming-qa-kit-<timestamp>` folder. Existing folders are preserved. `-WithoutRelay` omits the relay/runtime, and `-SkipChecks` is for iterations after checks already passed.

Copy the **entire kit folder** to both Windows x64 PCs. Testers need Windows with .NET Framework 4.8 and the Edge WebView2 Runtime. The build packages Vumiro's existing signed adapter/controller payloads; it does not install drivers while building or launching. An unsigned private Debug build may show Windows' usual publisher prompt when starting its elevated helper.

## Two PCs on one trusted private LAN

1. On PC A run **Gaming Relay.cmd** and keep that console open. It runs the current Worker in a local Miniflare/workerd runtime on port 8787, bound to all interfaces, with no Wrangler administration/explorer endpoint exposed. Its state is in `relay-state`. Type `stop` and Enter to shut it down. This never runs a deployment command and does not require a Cloudflare login. If Windows Firewall asks, allow this listener only on your trusted private network. Guest Wi-Fi/client isolation or a firewall may prevent PC B reaching it.
2. Find PC A's private IPv4 address using `ipconfig`, for example `192.168.1.20`. On PC A run **Gaming Host.cmd** (default relay is its own loopback address).
3. On PC B open PowerShell in the copied kit and run `./Start-GamingQa.ps1 -Profile guest -SignalingUrl ws://192.168.1.20:8787/call-signaling`. Substitute PC A's actual address. Both apps must show LOCAL QA / LOCAL SERVICE. Both must use this same private relay; the production service has not been updated with this branch's gaming support.
4. The private QA entry screen opens an isolated local profile directly, without a production account login. Give the two isolated local profiles different names. Use their Vumiro IDs/friend tags to add each other and accept friendship. This Worker retains Vumiro's normal signed identity challenges, mutual friendship and invitation checks. It does not substitute an unauthenticated test broadcast relay. Account sign-in is not configured on the isolated Worker; use its local profiles.
5. Invite the friend to gaming. Accept on the other PC. Exercise remote play, shared input and game LAN discovery using the real two-PC session. A transport-only loopback test does not establish these results.

For two app windows on one PC, run `./Start-GamingQa.ps1 -Profile host` and `./Start-GamingQa.ps1 -Profile guest`. Profile names select separate signing identities, settings and browser storage under `%LOCALAPPDATA%/Vumiro/GamingQA/<profile>`. This is useful for signaling/UI checks; a second PC remains necessary to establish remote capture and game connectivity. Avoid simultaneous account OAuth sign-ins because the desktop callback has one fixed loopback port.

`-SignalingUrl wss://your-existing-private-test-endpoint/call-signaling` also works when both PCs can reach a separately provided secure test endpoint running this Worker. This kit does not create a tunnel or publish a backend. Private `ws://` uses an explicit process-only WebView2 mixed-content exception in the LOCAL QA launcher; use it only on a trusted LAN. It does not alter the installed app's browser configuration. `ws://` accepts only loopback or a literal RFC1918 IPv4 address; other hosts require WSS. Reaching the relay across the internet may require your own WSS relay/tunnel and WebRTC TURN infrastructure; the kit does not claim otherwise.

## What the native checks establish

The Gaming Lab's native controller check temporarily creates an Xbox device, submits a distinctive button/stick/trigger report, reads the actual report through Windows XInput, verifies neutral input and removes the device. It refuses to run while a gaming LAN or remote input device is active. If the virtual controller driver is absent, it reports **unavailable**; diagnostics never install it silently. Starting a real session uses Vumiro's normal explicit driver setup path.

The native LAN check runs through Vumiro's elevated helper, so Windows may show UAC when you click it. It creates a temporary Vumiro Wintun adapter, checks Windows-to-adapter and adapter-to-Windows UDP plumbing, removes the adapter and verifies cleanup. It refuses an existing LAN session and avoids diagnostic subnets already assigned on the machine. A firewall can block the UDP readback and is reported. These are **local adapter checks**, not evidence that another computer or game is reachable. Neither native check runs automatically when opening the app or the lab.

The bridge action is `{type:'gaming', action:'self-test', requestId, kind:'lan'|'controller'}`. Its `gaming-result.result` contains `{passed, checks:[{id,label,status,detail}]}`, with each status `passed`, `failed` or `unavailable`. A completed report can contain failures while the bridge request itself succeeds. Invalid requests or use outside LOCAL QA return a bridge error.

Developer regressions: `dotnet run --project tests/GamingDiagnosticsChecks/GamingDiagnosticsChecks.csproj`, plus existing GamingServiceChecks/GamingHostChecks/GamingLanChecks. Explicit `-- --integration-controller` on GamingDiagnosticsChecks performs the real XInput check and always disconnects its temporary pad. Real LAN diagnostics are user initiated through the lab and require its elevation prompt.

## Acceptance checklist

- Both PCs show LOCAL QA and resolve each other's private-relay presence/invitations.
- The local-only transport experiment and both native checks report their actual scope and outcomes.
- Real remote capture shows the selected host screen and audio on the guest; stopping releases capture.
- A guest key mapped to each remapped control produces the expected host controller input; blur/stop/disconnect releases it.
- The target game lists/joins its LAN session between the two PCs; connect/disconnect removes only Vumiro's own adapter.
- Closing QA exits that QA instance. Reopening preserves only its isolated QA profile. Closing the relay ends private signaling; the installed production app is unaffected.
