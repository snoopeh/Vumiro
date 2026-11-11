# Native gaming bridge

The trusted friends.html WebView sends correlated `gaming` requests. GamingBridge.cs dispatches local readiness, LAN operations and session-scoped controller reports. Native packets are marshaled with bounded 128-packet/2MiB UI queues and checked against the current session, helper and navigation generation. Old navigation results cannot revive native state.

GamingServices.cs reports Vumiro runtime readiness only. It contains no provider tokens, network-joining HTTP calls, executable discovery or third-party launch routes. Obsolete external setup/join/stream actions are rejected.

The desktop remains unelevated. LAN/driver operations use GamingHostClient.cs to start the already bundled Vumiro.Updater.exe in its restricted gaming-host mode. There are no runtime network downloads. The helper verifies pipe peer PID, expected parent executable, commands and fixed payload hashes; see GAMING-RUNTIME.md for details.

Native regression projects are GamingServiceChecks, GamingControllerChecks, GamingDependencyChecks, GamingLanChecks and GamingHostChecks. Actual adapter creation requires Windows authorization and remains separate from unprivileged automated checks.
