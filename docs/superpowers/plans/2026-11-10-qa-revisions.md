# QA revision implementation plan

**Goal:** Address the second human QA pass without publishing changes.

**Design:** Notifications open explicitly by click or keyboard activation. One persistent settings shell owns navigation, language selection and content geometry; profile, account and audio are panels inside it. A parent room loading surface covers iframe startup until the child connection UI is ready. Production lobby entry requires an authenticated account. Successful provider sign-in opens the lobby directly after required identity restoration; genuine encrypted-identity recovery remains protected. Native nudges move a restored window for a bounded duration; silent/reduced-motion nudges draw a click-through monitor border. Maximized/fullscreen/minimized windows retain their state and use the border. Native window edges remain resizeable independently of WebView content.

## Execution

- [ ] Notifications: reproduce hover opening, change regression to click-only, implement and commit.
- [ ] Settings: trace the separate-dialog transitions, retain a common shell and preserve draft/save behavior; test and commit.
- [ ] Rooms: reproduce the parent iframe startup gap; show immediate parent feedback, transfer ownership to the child loading surface and preserve cancellation; test and commit.
- [ ] Account/OAuth: regression-test account gating and provider profile creation, preserve encrypted recovery, verify browser/app focus handoff; implement and commit.
- [ ] Native window: regression-test native nudge bridge, movement restoration, screen overlay lifetime and native resize edge geometry; implement and commit.
- [ ] Review the changed boundaries, run the required launcher checks once, inspect the real LOCAL QA window, and update the human QA checklist.

Changes remain local on the current development branch. Human acceptance precedes push and release. Do not use real account credentials in automated tests or bypass encrypted identity recovery.
