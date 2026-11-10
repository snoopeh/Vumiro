# Vumiro 1B — Improve Existing Flows

Date: 2026-11-05

Status updated 2026-11-08: all seven 1B source items implemented and reviewed; human QA pending. No release or production-service deployment.

## Context and working rules

Implement the approved acceptance criteria in `.planning/specs/1b-improve-existing-flows-acceptance-criteria.md`. The repository is on `main` with extensive existing, uncommitted work, including changes from the preceding UI task. Preserve all of it; do not reset, stash, or commit. Work inline because the required baseline includes the dirty checkout. Do not touch release metadata, publish, deploy, or alter production services. Keep desktop and Linux behavior consistent. Use the existing app-owned sound model; Discord is only a behavioral reference. Validation is allowed under the user's request to review the acceptance criteria before calling the work ready.

## Tasks and acceptance checkpoints

1. **Profile/settings drafts and save feedback** — `friends-client.js`, `friends.html`, profile/settings tests. Stage avatar/banner selection and removal without persistence; commit the pending image and text/link values together on explicit profile Save; discard on cancel/close/reopen. Add concise success feedback for profile image rejection/change and settings saves, and actual loading state during image processing/save. Keep existing settings section boundaries unless a screen already has a single save action. Verify cancellation, success, invalid image, failed save, and no partial image write.
2. **Directory discovery** — `cloudflare/friend-directory.js`, `friends-client.js`, `friends.html`, Cloudflare/client tests. Preserve exact #tag/contact-code/identity resolution; add case-insensitive prefix discovery for online username and display name, deduplicated and capped at 20; explicit cap notice. Render selectable results; require selection before sending a friend request; guard stale responses, blocked users, duplicates, existing friends/requests, offline state, and disconnect cleanup.
3. **Remote mute state** — `call-client.js`, call tests. Extend peer announcements compatibly with an explicit `micMuted` boolean; show accessible muted status for remote participants. Update it on mute/unmute/reconnect/leave; unknown legacy peers remain neutral.
4. **Participant hover controls** — `call-client.js`, `call.html`, call tests. Hide nonfocused participant playback controls until hover/focus; provide a keyboard/touch toggle. Keep focused participant controls visible, functional sliders reachable, and reduced-motion behavior.
5. **Room chat formatting/emoji** — `call-client.js`, `call.html`, call tests. Add accessible formatting and emoji controls; render bold, italic, inline code, safe HTTPS links, and line breaks via DOM APIs only. Never interpret HTML. Preserve plain text composition and the 2,000-character cap.
6. **App-owned event sounds** — `friends-client.js`, `call-client.js`, settings UI/state, audio/event tests, bundled source assets as needed. Add toggleable original/licensed Vumiro cues for incoming calls (ring until terminal state), participant join/leave, incoming chat (not while active), incoming friend/room notices. Deduplicate event/reconnect paths, suppress own messages and repeated state snapshots. Do not fetch sound assets at runtime.
7. **Real loading states** — add status/progress to directory lookup/request, profile-image process/save, settings save, room join/reconnect, and screen-share start/stop. Tie UI to actual promises/events, clean up on success/error/cancel, preserve reduced-motion and <=200ms transitions.

## Integration sequence

- Add focused failing tests at the behavior boundary before each implementation slice.
- Implement in dependency order: profile drafts/feedback; directory results; call protocol/layout; chat; sound settings/event lifecycle; real loading state; integration review.
- Run focused tests for each slice, then the existing client and Cloudflare suites once at the end. Run the local QA launcher after source and native status are ready, verify it points to this checkout, and report “ready for human QA” only if launcher validation is clean.
- Self-review every item against the acceptance criteria document, inspect the final diff for accidental changes to pre-existing work, and report known limitations explicitly.

## Self-review of this plan

- Criteria map one-to-one to the seven approved 1B items.
- Exact identity lookups and current local-friends search stay intact.
- Compatibility and privacy are explicit for list lookup and remote mute protocol.
- Sound cues are Vumiro-owned, semantic, deduplicated, and offline-bundled.
- Image edits cannot persist before explicit Save; cancellation and failure are addressed.
- Required loading states are tied to true asynchronous boundaries.
- Existing dirty work is preserved, QA remains local, and release operations are excluded.

## Implementation review

| 1B item | Review result | Evidence / remaining QA |
|---|---|---|
| Profile/settings drafts and feedback | Implemented | Image edits stage until one profile Save; dismissal invalidates pending image work. Room, connection, and sound settings save explicitly, including the in-room quality panel. Operational microphone/device/playback controls intentionally remain immediate. Errors and saved state use a transient accessible toast. Profile draft regression tests pass. |
| Multi-match discovery | Implemented | Authenticated online prefix search returns up to 20 distinct users; tags/codes remain exact; selection, blocked/offline guards, latest-query handling, and reconnect cleanup are in place. Worker tests cover display-name matching and cap. |
| Remote mute | Implemented | Data-channel announcement includes an explicit compatible mute flag; tile and People list show a mic-off icon and text. Connection loss clears stale state until a fresh announcement. Old peers remain unknown. |
| Contextual audio controls | Implemented | Secondary tile controls reveal on hover/focus and have a touch toggle; focused controls remain visible. Existing volume tests pass. |
| Chat formatting and emoji | Implemented | Safe text-node renderer supports bold, italic, inline code, line breaks, and HTTPS links; toolbar inserts formatting and Unicode emoji. The picker now has searchable categories and recent emoji; room chat works alone/reconnecting and signed recent history catches up new peers. Paperclip file transfers are a separately requested extension. Rendering, picker and transport regressions cover these paths. |
| Event sounds | Implemented | Original synthesized Vumiro cues cover incoming calls, participant changes, inactive-chat messages, and incoming friend/room notices. Preview and saved master toggle share the same preference. Background chat cues now work; multi-note join/leave cues have distinct scheduled notes. |
| Loading and motion | Implemented | Search, request, image processing/save, explicit settings save, room join/reconnect, and share start/stop report real operation state. Actual pending statuses now include spinners; completion/cancellation clears busy state. Entry/press transitions use 160 ms and honor reduced motion. |

Automated validation is recorded in `dist/local-qa/logs` by the final launcher and in the focused regression suites. Source review is complete; human acceptance, audible quality, motion/accessibility on real devices, real peer-network behavior and release approval remain pending. Use `scripts/Run-Local.ps1 -LocalService` to inspect named tags against the isolated local Worker. No human acceptance or release is recorded.

## Follow-up scope clarification

The November 8 request explicitly adds named handles, recent in-memory chat synchronization and direct attachments beyond the original 1B minimum. These are implemented for local review; they do not deploy the directory or create a server-side chat-history service. Profile, room quality/defaults, connection and app-sound menus use Save; immediate call operations and hardware/playback adjustments remain live controls.

November 9 follow-up: random five-digit named discriminators replace sequential three-digit allocations; one-time directory migration retains legacy numeric tags. The emoji panel uses scoped controls, compact accessible categories and Lucide toolbar symbols. Attachments can stage alone and offer to late joiners, with explicit-receive raster/GIF previews and opt-in public-link thumbnails. App sounds have a louder default and separate saved 0–300% volume. Room invitations now include direct friend actions plus expiring opaque links and human codes, with current access rules and password checks preserved. These service changes are running only in local QA. Generic website/OpenGraph metadata fetching is not implemented; link cards and supported image/YouTube thumbnails are available. Human QA and release remain pending.
