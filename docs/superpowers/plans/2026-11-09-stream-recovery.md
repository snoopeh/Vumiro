# Stream recovery and graceful departure

Date: 2026-11-09
Status: Implemented in local source; automated checks and human acceptance are separate gates. Nothing is pushed, deployed, version-bumped, or released.
Source: Priority 1C in the Vumiro product-improvements backlog.

## Product and UX contract

A brief network interruption should not require leaving the room, selecting a screen again, or changing mute settings. A failed direct connection should try a small number of recoveries, then explain the limitation and offer manual Reconnect. Leaving must always stop local capture, even if a remote peer or playback cleanup fails.

- Give a disconnected peer four seconds to recover naturally. Failed ICE starts recovery promptly.
- Reuse the existing peer connection and its already-authorized tracks. Never invoke screen or microphone permission prompts automatically.
- Permit at most three ICE restarts per outage, with a ten-second watchdog after each attempt. This also bounds a restart stuck in checking/connecting.
- Preserve the existing perfect-negotiation roles and serialized SDP handling.
- Show progress in the existing participant status. On exhaustion, expose Reconnect even if the browser still says connecting; keep an actionable explanation visible.
- Reset the retry budget on connection success. Cancel outstanding work on peer removal, room departure, manual reconnect, or signaling loss.
- Recovery does not add TURN, a media relay, a server protocol, new dependencies, persistence, or capture permissions. Networks that cannot form a direct route may still fail.

## Architecture and security review

A small scoped recovery controller owns one timer, retry count, terminal state and disposal. It accepts the peer connection, a current-session predicate, and a status callback, which makes its behavior deterministic to test. The current-session predicate checks both map object identity and room generation, joined state, and live signaling socket. SDP work checks that predicate after asynchronous operations; late candidates cannot signal from a departed peer.

The existing server already forwards ICE-restart SDP/candidates, including usernameFragment. Existing authentication, block rules, access rejection codes and direct-only relay checks remain intact. No private SDP, candidates, addresses, passwords or grants are added to diagnostics.

Graceful-departure follow-up stops local tracks before fallible remote cleanup, detaches obsolete callbacks, cancels timers and releases media references independently. A pending identity lookup must not reopen a socket after Leave.

## References and rationale

- [MDN: restartIce](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/restartIce): requests negotiation, retains a pending restart across rollback and preserves existing media while ICE restarts.
- [MDN: perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation): retain polite/impolite collision handling rather than introducing a competing offer path.
- [MDN: ICE connection state](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/iceConnectionState): disconnected can be transient; failed calls for explicit recovery.
- [MDN: MediaStreamTrack.stop](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop): stop authorized capture tracks explicitly and release media references during departure.

The four-second grace, three-attempt cap and ten-second watchdog are conservative MVP defaults, not protocol requirements. Initial connection establishment that never reports failed/disconnected remains outside this outage-recovery increment.

## Verification and review

- New deterministic tests: transient recovery, failed ICE, repeated callbacks, bounded checking, reset after success, unsupported/throwing restartIce, synchronous callbacks, disposal and saved canceled callbacks, late SDP/ICE, negotiation collision roles, and exhausted manual recovery.
- Focused validation after recovery implementation: 68 call/audio/feedback/recovery tests passed. JavaScript syntax passed.
- Existing uncommitted work was present before this task. Only this increment's source hunks, tests and design record are committed; prior changes stay unstaged. Validation of the working checkout necessarily includes that earlier work.
- Human QA and real two-device WebRTC behavior are not established by the VM tests.

## Human acceptance checklist

1. Join a room from two real clients. Share a screen and enable a microphone; mute it.
2. Briefly interrupt one client's network and restore it. Confirm automatic recovery without a new capture prompt and with mute preserved.
3. Keep the direct connection unavailable. Confirm retries stop after three attempts and Reconnect remains visible and usable.
4. Stop sharing during recovery. Confirm sharing does not restart by itself.
5. Leave during recovery, and repeat Leave/close. Confirm capture indicators turn off and no later timer rejoins.
6. Have the other participant leave while audio/video is playing. Confirm the remaining app stays usable.
7. Check these flows in Windows and Linux. Linux/device acceptance remains a human gate.
