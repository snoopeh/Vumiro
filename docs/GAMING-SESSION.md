# Built-in gaming session protocol

`Vumiro.Client/WebServer/gaming-session.js` implements Vumiro's own invitation,
WebRTC, LAN forwarding, and controller transport. It uses browser WebRTC and
screen capture APIs, the existing P-256 local identity, and the native gaming
bridge. No external streaming application is launched by this engine.

## Browser API

Create one engine with `window.VumiroGamingSession.create(options)`. Supply:

- `local`: the existing `VumiroLocalProfile` API.
- `send(envelope)` and `getFriend(id)`: the current signed friend-directory context.
- `requestNative(action, fields)`: the desktop gaming request bridge.
- Optional `onState(snapshot)`, `onInvitation(invitation)`, and `onTrack(media)`.
- Optional `iceServers`: up to eight standard `RTCIceServer` definitions. TURN
  usernames and credentials can be short lived. They are never exposed in snapshots.

Methods are `invite(peerId, 'lan' | 'together')`, `accept(sessionId)`,
`decline(sessionId)`, `receive(envelope)`, `stop()`, `snapshot()`,
`handleNativePacket(message)`, `setBindings(bindings)`,
`setInputMode('keyboard' | 'physical')`, `setInputFocused(boolean)`,
`setKey(code, down)`, `releaseInput()`, `startSharing(settings)`, and
`stopSharing()`.

Call `startSharing()` directly from a click handler; the browser screen chooser
requires that user gesture. Optional settings are `frameRate: 30 | 60` and
`bitrateMbps: 2..30`, defaulting to 60 FPS and 12 Mbps. Sender bitrate tuning is
best effort. The browser and available bandwidth determine actual quality.
`onTrack` receives `{stream, track, local}`. A null stream clears the preview.
Separate incoming audio and video events share one playback stream.

The guest video surface must be focusable. On focus call `setInputFocused(true)`;
on blur, Escape, or leaving the view call `releaseInput()`. Pass key transitions
to `setKey`. The engine samples only while focused, at 60 Hz. Keyboard bindings
come from `VumiroControllerMapping`; physical input uses the browser's standard
gamepad mapping. Window blur also releases input. The host retains its own local
controls, and the remote player receives a separate virtual controller.

Snapshots include `state`, `sessionId`, `mode`, `role`, `peerId`, `accepted`,
`sharing`, `hasAudio`, `inputMode`, `inputFocused`, `lanAddress`, `peerAddress`,
`error`, `participants`, and `maxGuests: 3`. Each participant has its own state
and addresses. A LAN host can invite additional friends while its LAN exists.
Game together supports one guest plus the host's local player.

## Authentication and permissions

The signed envelope is:

```text
{type:'gaming-signal',from,to,session,nonce,expires,payload,signature}
```

`session` is 32 random lowercase hexadecimal characters, `nonce` is 24 random
base64url characters, and `expires` is a millisecond timestamp 60 seconds ahead.
The signature covers these lines, joined with a single newline:

```text
vumiro-gaming-signal-v1
from
to
session
nonce
expires
JSON.stringify(payload)
```

Every message requires a currently saved friend, a valid signature, a valid
recipient, bounded payloads, and a fresh nonce. Replay storage is shared between
the engine's peer instances and bounded to 4,096 entries. Total envelopes are
bounded to 16 KiB; SDP is bounded to 12,000 characters. The directory adapter and
backend additionally validate their message schemas and friendship permissions.

Payload kinds are `invite`, `accept`, `decline`, `offer`, `answer`, `ice`, `end`,
and `lan-peers`. An invitation alone creates no peer connection or native input
device. The invited friend must explicitly accept. Only the inviting host creates
the offer. A session epoch prevents late verification, SDP, and capture operations
from reviving a stopped session. Stopping sharing cancels a pending screen
chooser and revokes the host's remote controller until sharing starts again.
Established peers recheck the saved friend and trusted key every second and on
friend-book changes. Removing a friend or replacing its trusted key closes that
peer connection and revokes its native access while other LAN guests remain.

## LAN group

A group uses one native adapter on each PC and a host-centered star of WebRTC
data channels. The host is `10.203.N.1`; up to three accepted guests receive
`.2` through `.4`. `N` is derived from the random session ID in the range 1..250.
The invitation signs `lan: {address, peerAddress, prefix:24}`, where `address`
is the host and `peerAddress` is the invited guest. The host keeps one common
session ID and subnet for the group.

The host sends signed membership updates
`{kind:'lan-peers', revision, addresses}`. Revisions increase, and guests reject
older updates. Native `lan-set-peers` allowlists contain accepted remote
addresses only. A guest's source address must match its signed assignment.
Unicast goes to its assigned peer; broadcast and multicast reach the host and
other accepted peers without being reflected to their sender. A guest leaving
updates the membership and allowlist without stopping other guests.

`vumiro-lan-v1` is unordered with no retransmissions. Packets are IPv4, at most
1,500 bytes, and use binary ArrayBuffers. Native events use
`{type:'gaming-lan-packet', sessionId, packet:base64}`. Native requests are
`lan-start`, `lan-status`, `lan-set-peers`, `lan-packet`, and `lan-stop`.
Adapter startup is polled until active; merely requesting startup does not count
as a connected LAN. Browser send buffers and native in-flight writes are bounded.
The native adapter independently enforces IPv4 checksums, source and destination
boundaries, and allowed protocols.

## Remote controller

`vumiro-input-v1` is unordered with no retransmissions. Its JSON frames are
`{sequence, frame:{buttons,leftX,leftY,rightX,rightY,leftTrigger,rightTrigger}}`.
Host validation rejects non-finite fields and duplicate or older sequences,
clamps XUSB ranges, clears reserved button flags, and allows one native write
in flight with the newest pending frame replacing older input.

Native requests are `remote-controller-start {sessionId}`,
`remote-controller-frame {sessionId,sequence,frame}`, and
`remote-controller-stop {sessionId}`. Native watchdogs provide an additional
neutral-input fail-safe. Ending a session closes its data channels, peer
connections, media tracks, native adapter, and remote controller.

## Connectivity and verification limits

The default ICE server is the project's existing Cloudflare STUN endpoint.
Valid TURN configurations and relay candidates are supported, but no TURN
deployment or credential provisioning is included by default. Strict NAT or
firewalls can prevent connection; the engine reports that failure explicitly.
Screen audio is included only when the browser capture returns an audio track;
`hasAudio` reports this actual condition.

Run `node --test tests/gaming-session.test.mjs`. The tests cover real P-256
signature integrity, unknown senders, replay, acceptance gating, cancellation,
focus release, fractional gamepad axes, sender quality settings, optional TURN,
multi-guest addressing and forwarding, source spoofing, membership revisions,
and leaving one guest without tearing down the others. WebRTC/browser/native
boundaries in this automated unit suite use mocks.

For a live browser transport check, open an isolated LOCAL QA WebView2 with a
debugging port and run `node tests/gaming-webrtc-loopback.mjs http://127.0.0.1:PORT`.
This creates ephemeral P-256 identities and real peer connections inside a
temporary iframe. It checks decoded canvas video, decoded oscillator audio,
controller input and neutral release, and two-guest LAN forwarding with source
spoofing rejection. All native requests in this check are intercepted. Its report
is saved under `dist/gaming-webrtc-loopback/result.json`. It removes its iframe,
closes peers, stops tracks, and restores browser hooks without using account data.

Two-PC Windows testing remains necessary to establish actual game discovery,
screen/game capture and system audio behavior, latency, and controller support.

API references: [WebRTC](https://www.w3.org/TR/webrtc/),
[Screen Capture](https://www.w3.org/TR/screen-capture/), and
[Gamepad](https://www.w3.org/TR/gamepad/).
