# QA feedback: attention, motion, language and settings

The user requested these behaviors directly after reviewing the first 2A build. Implement them in independent commits and keep human QA and release approval separate.

## Notification presentation

Keep only a bell in the lobby. Explicit activation toggles a sliding list below the bell; hover/focus leaves it closed. Escape/outside click closes it. Each event shows the validated sender's avatar, name and activity. New incoming events produce a bounded, dismissible popup on every app screen, including above modal settings. Background operation also uses a native popup without moving focus or auto-accepting calls. Clicking opens the event's origin after any required settings Save/Discard/Keep editing decision and revalidates the local action ID. Protected confirmations and editors must be finished or canceled first. No arbitrary URLs or HTML cross the host bridge.

## Motion and room entry

Use the approved reveal and sakura masters from the sibling vumiro-motion folder. Play the reveal once per app launch with Skip and reduced-motion handling, then fade black into sign-in. Petals stay behind the form, pause when hidden, and have a visible motion toggle. Room entry displays an actual connecting state and error/retry/cancel controls. Chat retains one native scroll range with a transparent track and a red thumb that fades over 220ms on hover/focus/scroll. The overlay thumb follows the native range, clamped to 20–60% of the track; no overflow hides it. Native styling remains the fallback. On desktop, default chat width is 24% of the room viewport; a pointer and keyboard separator adjusts it up to 30%, preserving the completed ratio. Compact windows retain the stacked layout.

## Chat delivery

Text messages have no sender or receiver time cooldown. Snapshot each accepted submission and serialize signatures without overwriting a newer draft or reply. Recheck room epoch and signing identity before publishing; preserve failed text visibly. Keep message-size, bounded pending work, history and network backpressure limits. Metadata/file throttles remain independent. Peers running older clients retain their own receiver limits until updated.

## Identity and languages

Keep directory-issued nickname#code as the authoritative identifier. A numeric-only ready message must not delete a previously assigned named handle; explicit profile responses can replace an old assignment. Diagnose old-service capability separately from client rendering; do not invent a handle that lookup cannot resolve. Offer English, Spanish, Brazilian Portuguese, Japanese, Simplified Chinese and Russian using autonyms plus a globe on login and persistent app controls. Explicit choice wins over system preference, survives restart and updates the room frame. Translation must exclude user-generated content and preserve drafts/focus.

## Settings exit

Track drafts against saved baselines across settings destinations. Escape, the close control and Back ask Save changes, Discard changes or Keep editing when drafts differ. Failed saving keeps settings open and preserves the draft. Successful saves advance only their own baseline. Closing clean settings remains immediate. Operational microphone/call controls retain their immediate behavior. Initially focus the settings heading; show only one language focus indicator when keyboard navigation calls for it.

## Friend nudge

Send a signed, short-lived nudge through the existing authenticated peer profile channel. Only current online unblocked friends may send or receive it. Apply a per-friend 30-second send/receive limit, a global burst limit, replay dedupe, and a bounded pending queue. Recheck identity/friendship after asynchronous signing/verification. The receiver controls Allow nudges and Silent mode. Normal mode moves a restored native window briefly and restores its exact bounds; silent mode or reduced motion shows a feathered yellow monitor frame for the same duration without shaking or sound. Maximized, fullscreen and minimized windows retain their state and use the glow. No focus stealing or repeated timer extension. Send acknowledgment before reporting delivery; old peers safely ignore the extension. Browser/Wayland restrictions use a viewport glow.

## Authenticated entry

After successful provider authentication and required identity checks, enter the lobby. The auth route shows sign-in progress while account data loads, never account management. Account management belongs to the persistent lobby settings shell. An existing encrypted identity on a different device still requires a valid password or recovery code. A temporary account-data failure offers Retry; it must not expose management or skip recovery.

## Verification and references

Exercise draft save failures, discard and clean exits; sender attribution, popup activation, stale actions and minimized Windows operation; named-handle cache sequencing; all language catalogs, autonyms and protected content; real connection loading/error; signed nudge tamper, replay, cooldown, block, identity reset, timeout and silent mode. Use focused tests while iterating, then one full LOCAL QA launcher before handoff.

- Microsoft notification UX: https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-ux-guidance
- W3C motion from interactions: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
- W3C pause/stop/hide: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- W3C language selection: https://www.w3.org/International/questions/qa-site-conneg.en.html
- Chromium scrollbar styling: https://developer.chrome.com/docs/css-ui/scrollbar-styling
- HTML popovers and the top layer: https://html.spec.whatwg.org/dev/popover.html
- WAI-ARIA window splitter: https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/
- WAI-ARIA dialog initial focus: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
