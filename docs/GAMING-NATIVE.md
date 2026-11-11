# Native gaming adapters

The Windows app integrates installed ZeroTier One for LAN membership and installed Sunshine/Moonlight for game streaming. Setup links open official pages; the app does not install dependencies, change firewall rules, or run commands supplied by the web interface.

## LAN

`GamingServices` reads ZeroTier's local token from `%ProgramData%/ZeroTier/One/authtoken.secret` and calls only `http://127.0.0.1:9993`. It disables proxying and redirects so that authentication headers stay on loopback. Each request times out after three seconds and responses are limited to 1 MiB.

Status reads `/status`, `/network`, and `/peer`. Joining sends `POST /network/<id>` with `{}`; leaving sends `DELETE /network/<id>`. Network IDs must contain exactly 16 hexadecimal characters. Responses are projected into explicit UI fields; tokens, service credentials, raw response objects and exception details are never returned to JavaScript.

A successful join submits local membership. Private networks still need authorization in [ZeroTier Central](https://my.zerotier.com/). The network's actual `status` and assigned addresses are shown after refreshing. Missing installation, missing token, Windows permission denial, rejected authorization, stopped/timed-out service, offline node, and malformed API response have distinct status messages.

Protocol references: [ZeroTier local service API](https://docs.zerotier.com/api/service/v1/) and [official CLI implementation](https://github.com/zerotier/ZeroTierOne/blob/dev/one.cpp).

## Streaming

Discovery checks fixed installation paths under Program Files, Program Files (x86), and Local AppData/Programs (plus the corresponding Local AppData paths). Supported relative paths are `Moonlight Game Streaming/Moonlight.exe`, `Moonlight/Moonlight.exe`, and `Sunshine/sunshine.exe`. Custom/portable locations outside these paths are reported as undetected. Executable launches use absolute paths and bypass the shell and PATH lookup.

Moonlight commands are `pair "host"`, `list "host"`, and `stream "host" "Desktop"`. Host arguments accept DNS names and IPv4/IPv6 addresses, with no switches, URLs, ports, scope identifiers, quotes or whitespace. The Desktop application name is fixed. `pair` opens Moonlight's pairing UI, where the user gets a PIN to enter on the host. `stream` opens Moonlight, which handles pairing failures, codec support, remote controller transport and stream availability. The adapter reports **launched**, not connected or paired. The host must publish an application named Desktop.

Opening host settings uses only `https://localhost:47990`, after detecting Sunshine. Sunshine controls credentials, application configuration, pairing approvals and hosting. Its certificate can require confirmation in the browser. The adapter never disables certificate validation.

CLI reference: [Moonlight's official command parser](https://github.com/moonlight-stream/moonlight-qt/blob/master/app/cli/commandlineparser.cpp). Host setup: [Sunshine getting started](https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2getting__started.html).

## Bridge

Requests use `{type:'gaming', requestId, action, ...}` where `requestId` contains 1–64 ASCII letters/digits. Supported native actions are `status`, `lan-join`, `lan-leave`, `open-setup`, `open-host`, `pair`, `stream`, and `list`. `open-setup` accepts only `zerotier`, `central`, `sunshine`, `moonlight`, and `driver`. Other actions are delegated to the controller adapter's finite action handler.

Replies contain `{type:'gaming-result',requestId,ok,result,error,errorCode}`. Status results contain `status.platform`, `status.lan`, `status.streaming`, and controller status at both `status.controller` and `result.controller`. LAN has `provider`, `state`, `installed`, `online`, `nodeId`, `version`, `networks`, `peers`, and `message`. Streaming has `provider`, `host` and `client`; dependency fields are `installed`, `state` and `message`.

`StopGaming()` releases the mapper and HTTP client and increments a page generation. Pending requests from the previous page cannot reply to a new document or recreate the mapper. A subsequent page can create a fresh adapter.

## Checks

Run `dotnet build tests/GamingServiceChecks/GamingServiceChecks.csproj` and then `tests/GamingServiceChecks/bin/Debug/net48/GamingServiceChecks.exe`. The checks link the production service/bridge and inject HTTP, token reader, dependency discovery and process launcher boundaries. They make no real joins, launch no external software and never read an installed token. Live network membership, real Sunshine/Moonlight streaming, remote input and GPU behavior still require human QA with the dependencies installed on the relevant PCs.

## Controller client packaging

The managed `Nefarius.ViGEm.Client` 1.21.256 dependency is embedded inside `Vumiro.exe` as resource `Vumiro.Gaming.ViGEmClient`. This preserves the existing fixed updater package file sets. `GamingDependencies.Register()` runs at application startup before the window is created. Its assembly resolver accepts only `Nefarius.ViGEm.Client, Version=1.21.256.0, Culture=neutral, PublicKeyToken=null`, loads the executable's own resource bytes, verifies the resulting identity, and caches the assembly. Foreign names, different versions, cultures, signing tokens, partial names, and file paths are rejected. The resolver reads no external DLL paths.

The managed package already contains its 32-bit and 64-bit native client libraries as Costura resources. Those resources remain inside the embedded assembly and use the package's existing loader. ViGEmBus remains a separately installed driver; embedding its client does not install or update the driver. A package version upgrade must update the pinned resolver identity and its checks together.

Run `dotnet build tests/GamingDependencyChecks/GamingDependencyChecks.csproj`, then `tests/GamingDependencyChecks/bin/Debug/net48/GamingDependencyChecks.exe`. This check starts a hidden console subprocess from a temporary folder containing only its EXE and config, verifies that no copy-local DLLs exist, tests identity rejection and cache reuse, loads and reflects `ViGEmClient`, confirms both embedded native resources exist, and constructs/disposes the client. Driver absence is an expected supported result; missing managed/native client libraries fail the check. The probe creates no virtual controller device.
