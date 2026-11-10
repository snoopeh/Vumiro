# QA revision implementation plan

**Goal:** Address the second human QA pass without publishing changes.

**Design:** Notifications open explicitly by click or keyboard activation. One persistent settings shell owns navigation, language selection and content geometry; profile, account and audio are panels inside it. A parent room loading surface covers iframe startup until the child connection UI is ready. Production lobby entry requires an authenticated account. Successful provider sign-in opens the lobby directly after required identity restoration; genuine encrypted-identity recovery remains protected. Native nudges move a restored window for a bounded duration; silent/reduced-motion nudges draw a click-through monitor border. Maximized/fullscreen/minimized windows retain their state and use the border. Native window edges remain resizeable independently of WebView content.

## Execution

- [x] Notifications: reproduce hover opening, change regression to click-only, implement and commit.
- [x] Settings: trace the separate-dialog transitions, retain a common shell and preserve draft/save behavior; test and commit.
- [x] Rooms: reproduce the parent iframe startup gap; show immediate parent feedback, transfer ownership to the child loading surface and preserve cancellation; test and commit.
- [x] Account/OAuth: regression-test account gating and provider profile creation, preserve encrypted recovery, implement browser/app focus handoff; implement and commit.
- [x] Native window: regression-test native nudge bridge, movement restoration, screen overlay lifetime and native resize edge geometry; implement and commit.
- [x] Review the changed boundaries, run the required launcher checks, inspect the real LOCAL QA window, and update the human QA checklist.

Changes remain local on the current development branch. Human acceptance precedes push and release. Do not use real account credentials in automated tests or bypass encrypted identity recovery.

Human QA still needs actual Google sign-in/focus, native drag feel, two-client delivery, and final acceptance. Automated and native probe results are recorded in `docs/QA-FEEDBACK-CHECKLIST.md`.

## Third QA pass

- [x] Keep authenticated auth-page rendering in sign-in progress, complete the no-remote-profile route explicitly, support retry, and preserve encrypted identity recovery (`77b3be0`).
- [x] Add the bounded chat splitter, persisted ratio, six-language labels and animated native thumb; include its module in Windows staging, Linux and web assets (`9fc8dbb`).
- [x] Lift popups above active modals, position the inbox below its bell, show fresh verified peer messages on every screen, and route actions through settings exit with stale-action checks (`232d79b`).
- [x] Independently review the changed boundaries; check actual Windows popup layering, Keep editing/Discard routing, separator dragging and intermediate scrollbar opacity.
- [x] Run the full official launcher and record final QA readiness: 462/462 client tests, all native gates and build passed. Human acceptance and release remain separate.

The full gate caught an old event-feedback expectation that suppressed visible-chat alerts. `acb6d57` aligns both signed and legacy chat sound behavior with the new request; focused checks and the rerun passed.

## Fourth QA pass

- [x] Reproduce the language selector's automatic focus and duplicate outlines; focus the settings heading and retain one keyboard indicator (`2eb1232`).
- [x] Remove sender cooldown and receiver text time gates; queue signing submissions, preserve newer drafts/replies and failed text, retain room/identity and network bounds (`98e2484`).
- [x] Give QA samples bounded local destinations; activate avatar/padding as well as text; wait for asynchronous navigation and retain canceled popups/inbox retry (`23e44cd`).
- [x] Bound the fading thumb to 20–60% of its track over the same native log; package and translate its controller (`b812fbf`).
- [x] Review and verify native interaction, run the official launcher: 485/485 client tests, all native gates and build pass. Human QA acceptance is pending; nothing pushed or released.
