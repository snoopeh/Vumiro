# QA feedback: attention, motion, language and settings

The user requested these behaviors directly after reviewing the first 2A build. Implement them in independent commits and keep human QA and release approval separate.

## Notification presentation

Keep only a bell in the lobby. Hover/focus opens a sliding preview; click pins the drawer, Escape/outside click closes it. Each event shows the validated sender's avatar, name and activity. New events produce a bounded, dismissible popup. A compatible native Windows popup covers minimized/background operation without moving focus or auto-accepting calls. Linux uses its native adapter. Clicking restores the app and revalidates the local action ID. No arbitrary URLs or HTML cross the host bridge.

## Motion and room entry

Use the approved reveal and sakura masters from the sibling vumiro-motion folder. Play the reveal once per app launch with Skip and reduced-motion handling, then fade black into sign-in. Petals stay behind the form, pause when hidden, and have a visible motion toggle. Room entry displays an actual connecting state and error/retry/cancel controls. Chat retains normal scrolling with a transparent track and a red thumb revealed on hover/focus/scroll.

## Identity and languages

Keep directory-issued nickname#code as the authoritative identifier. A numeric-only ready message must not delete a previously assigned named handle; explicit profile responses can replace an old assignment. Diagnose old-service capability separately from client rendering; do not invent a handle that lookup cannot resolve. Offer English, Spanish, Brazilian Portuguese, Japanese, Simplified Chinese and Russian using autonyms plus a globe on login and persistent app controls. Explicit choice wins over system preference, survives restart and updates the room frame. Translation must exclude user-generated content and preserve drafts/focus.

## Settings exit

Track drafts against saved baselines across settings destinations. Escape, the close control and Back ask Save changes, Discard changes or Keep editing when drafts differ. Failed saving keeps settings open and preserves the draft. Successful saves advance only their own baseline. Closing clean settings remains immediate. Operational microphone/call controls retain their immediate behavior.

## Friend nudge

Send a signed, short-lived nudge through the existing authenticated peer profile channel. Only current online unblocked friends may send or receive it. Apply a per-friend 30-second send/receive limit, a global burst limit, replay dedupe, and a bounded pending queue. Recheck identity/friendship after asynchronous signing/verification. The receiver controls Allow nudges and Silent mode. Normal mode briefly shakes app content; silent mode or reduced motion shows a feathered yellow frame for the same duration without shaking or sound. No focus stealing, no repeated timer extension, no native window repositioning. Send acknowledgment before reporting delivery; old peers safely ignore the extension.

## Verification and references

Exercise draft save failures, discard and clean exits; sender attribution, popup activation, stale actions and minimized Windows operation; named-handle cache sequencing; all language catalogs, autonyms and protected content; real connection loading/error; signed nudge tamper, replay, cooldown, block, identity reset, timeout and silent mode. Use focused tests while iterating, then one full LOCAL QA launcher before handoff.

- Microsoft notification UX: https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-ux-guidance
- W3C motion from interactions: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
- W3C pause/stop/hide: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- W3C language selection: https://www.w3.org/International/questions/qa-site-conneg.en.html
- Chromium scrollbar styling: https://developer.chrome.com/docs/css-ui/scrollbar-styling
