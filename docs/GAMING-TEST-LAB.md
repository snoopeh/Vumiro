# Gaming test lab

Load `gaming-lab.js` after `controller-mapping.js` and `gaming-session.js`.
Create one instance for the diagnostics panel:

```js
const lab = VumiroGamingLab.create({
  requestNative: (action, fields) => bridge.request(action, fields),
  getBindings: () => ({...bindings}),
  onProgress: check => renderCheck(check)
});

transportButton.onclick = async () => showResult(await lab.runTransport());
lanButton.onclick = async () => showResult(await lab.runNative('lan'));
controllerButton.onclick = async () => showResult(await lab.runNative('controller'));
captureButton.onclick = async () => showResult(await lab.testCapture());
cancelButton.onclick = () => lab.cancel();
addEventListener('pagehide', () => lab.dispose());
```

The capture method must be called directly from the button handler. It invokes
the browser chooser before awaiting setup, preserving the user gesture.

Each method returns `{passed, cancelled, kind, checks}`. A check has
`{id, label, status, detail}`, with status `passed`, `failed`, or `unavailable`.
`onProgress` receives a completed check in that same format. Overall `passed`
requires every reported check to pass. An unavailable audio track, permission
denial, timeout, cancellation or missing API is never presented as success.
The optional `timeoutMs` setting defaults to 20 seconds per awaited operation.
Native checks allow up to six minutes for Windows authorization and bounded helper work; an explicit timeoutMs overrides this for automated tests. Cancellation remains immediate in the UI, and a started native check finishes its own cleanup. Only one operation can run at a time.

## What the browser transport test verifies

`runTransport()` creates an isolated iframe and ephemeral P-256 identities. It
loads `local-profile.js` first, since release packages fold the session and mapping
modules into that frozen asset. If either module is absent in an unbundled
development checkout, it loads only the missing standalone script. This defines
the identity API without initializing a saved profile or generating an account
identity. The empty sandbox has no application navigation to initialize. Real
WebRTC connections run between test peers on this PC, with no STUN or TURN
servers. No saved profile, account key, contact book or live session is used.

The checks cover signed invitation and explicit acceptance, decoded canvas video,
decoded oscillator audio, the selected keyboard mapping while focused, neutral
release, and standard gamepad conversion using explicitly synthetic values. It
also creates a host and two guests, then sends real binary packets through their
RTC channels to verify unicast, broadcast without reflection, and rejection of a
spoofed source address.

The test intercepts all native calls. It therefore verifies browser transport and
conversion, not a Windows virtual adapter, installed driver, physical gamepad,
internet NAT traversal, game discovery, or a second PC. The real physical device
monitor in the Gaming interface is a separate manual check.

`getBindings` supplies the currently selected mapping. Its bindings are validated
before allocating test resources. The first bound key is converted using the
same mapping engine as the game, and the exact expected button, stick and trigger
values must arrive at the test host.

## Native tests

`runNative('lan')` and `runNative('controller')` are separate, explicit actions.
They issue `requestNative('self-test', {kind})` and require the native reply to
contain actual `{passed, checks}` results. A generic `{ok:true}` response does not
pass. The caller should label these as Windows adapter or controller checks,
separately from browser loopback. The native host decides LOCAL QA eligibility,
authorization, hardware access and temporary-resource cleanup.

Cancelling stops the UI's wait and ignores a late native reply. A native self-test
already started must finish its own bounded operation and cleanup; this browser
API does not invent a native cancellation command.

## Chosen-window capture

`testCapture()` asks the user to choose a window, sends that actual capture
through local RTC peers, measures video decode, and measures decoded audio if
present. A missing audio track or a silent source is reported as unavailable;
play sound in the selected game and enable sharing audio to verify game sound.
This method intercepts native requests and does not control the selected window.

## Cleanup and checks

Completion, failure, cancellation and disposal close test peers, stop tracks,
close audio contexts, remove the iframe, and restore its temporary browser hooks.
A screen selection that arrives after cancellation is immediately stopped.
No test runs in the background after the lab is disposed.

Run `node --test tests/gaming-lab.test.mjs` for cancellation, failure,
unavailability, native result validation, concurrency and mapping validation.
Real browser transport should additionally be checked inside the LOCAL QA app.
The optional `createSandbox` dependency exists for isolated lifecycle tests; normal
application callers should use the bundled browser sandbox.
