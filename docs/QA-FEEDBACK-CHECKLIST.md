# QA feedback checklist

Use the **LOCAL QA** window from `Local QA.cmd` or `./scripts/Run-Local.ps1`. Record Pass/Fail and any reproduction steps in the Result column. This checklist does not authorize a push or release.

Automated baseline: the full client suite passed **485/485**. The official launcher also passed all native gates, including window nudge/resize checks. Final Windows build: **0 warnings and 0 errors**. Human acceptance remains pending.

| Check | Action | Expected behavior | Result |
| --- | --- | --- | --- |
| Sender popup | Generate an incoming notification with a known friend. | Popup shows the correct sender name, avatar, and activity. Dismiss works; no call is accepted automatically. | Pending |
| Popup on every screen | Receive a message/call while reading chat, browsing the lobby, and viewing each settings section. Click the avatar, text, or card padding. Repeat with an unsaved setting and choose Keep editing, then Discard. Also try all QA notification samples. | Clicking opens the source chat, invitation, friend request, or room listing. QA friend/room/desktop samples route to Friends/Rooms/inbox. Keep editing preserves the draft and leaves the popup retryable. Expired/removed actions cannot navigate. Protected editors or confirmations must be finished/canceled first. | Pending |
| Minimized desktop popup | Open **Settings → QA notification tests → Test desktop popup in 3 sec**, then minimize within three seconds. Click the desktop popup. | A desktop popup appears while minimized. Clicking the QA sample restores LOCAL QA and opens notifications. Real live notifications open their still-valid target without automatically accepting a call. | Pending |
| Bell drawer | Hover or keyboard-focus the bell, then click it or use keyboard activation. Click again without moving the mouse. Try Escape and an outside click. | Hover/focus leaves it closed. Explicit activation toggles the sliding drawer. The drawer starts 12px below the bell and never covers it. Escape/outside click closes it. | Pending |
| Chat scrollbar | Scroll a short and a long overflowing chat; drag the thumb to both ends, use its keyboard controls, and try the mouse wheel. Stop interacting. | Thumb occupies 20–60% of the track, proportional within those bounds; it is hidden when messages fit. Track stays transparent. The red thumb fades over 220ms. There is only one native scroll range; wheel/touch/content keyboard behavior remains normal. Reduced motion removes the animation. | Pending |
| Instant chat | Send several messages rapidly, including while typing the next draft. Repeat with two updated clients. | No timed cooldown on outgoing or incoming text. Submissions queue during signing without losing new drafts or replies. Failed signing preserves the original text. Network backpressure and bounded pending work still apply; older remote clients keep their own limits until updated. | Pending |
| Chat width | Drag the handle between the stream and chat. Also focus it and use Left/Right, Shift+Left/Right, Home and End. Resize the app and reopen a room. | Desktop default is 24% of the room viewport; maximum is 30%. Completed size persists proportionally. Cancel/lost capture restores the prior size. Narrow windows retain the stacked layout. | Pending |
| Room connection | Click Create room and watch the first frame. Cancel immediately once; then create again. Repeat with an unavailable connection; try **Try again**. | Main app shows loading immediately, including before child scripts/identity finish. There is no blank pane. Child connection screen takes over through a validated readiness handshake and reflects actual joining/reconnecting. A successful join dismisses it. Errors/slow connection offer recovery; Cancel leaves the attempt and Retry starts a fresh attempt. Password entry stays accessible. | Pending |
| Launch reveal | Close and relaunch a signed-out LOCAL QA window. Try **Skip intro**, then navigate internally back to sign-in. | Approved reveal starts from black and transitions into sign-in. Skip immediately enables the form. Internal navigation does not replay the reveal. Launch tracking uses session storage for that app session. | Pending |
| Login petals | Watch the sign-in screen; use **Pause petals** and **Resume petals**. Hide and restore the window. | Petals stay behind the form, do not block input, pause on request/while hidden, and resume appropriately. | Pending |
| Reduced motion | Enable the system reduced-motion preference, then open sign-in and receive a nudge. | Intro is skipped; petals are hidden. A nudge uses the yellow glow without shaking. | Pending |
| Settings exit | Change a setting, move between settings sections, and attempt exit using Escape, Close, and Back. Exercise **Save changes**, **Discard changes**, and **Keep editing**. | Dirty drafts prompt consistently across sections. Save persists changes; Discard restores saved values; Keep editing preserves drafts. Failed saving retains the draft and open settings. Clean settings close immediately. | Pending |
| Six languages | Select **English**, **Español**, **Português (Brasil)**, **日本語**, **简体中文**, and **Русский**. Reopen the app and check an embedded room. | Autonym choices remain visible on sign-in and at the same location in every settings section. The lobby sidebar duplicate is removed. Explicit selection persists and updates the room. User names/messages, drafts, and focus are preserved. Human linguistic review is still required. | Pending |
| Friend nudge | Use **two updated clients**, online as mutual friends. Send a nudge, then try another within 30 seconds. | A restored Windows window physically moves for 900ms, then returns to its exact original bounds without sound or focus stealing. Maximized/fullscreen/minimized windows retain their state and use monitor glow. Sender reports delivery only after acknowledgment. Cooldown prevents repetition. Real two-peer human QA remains pending despite passing transport unit tests. | Pending |
| Nudge preferences | On the receiver, enable **Silent mode**, receive a nudge, then disable **Allow nudges** and retry after cooldown. | On Windows, Silent mode gives a feathered yellow border around the monitor containing Vumiro, outside app bounds. The overlay passes clicks through and disappears after 900ms. Disabled nudges produce no effect and are not reported as delivered. Repeated effects do not extend the 900ms duration. | Pending |
| Settings consistency | Navigate Profile → Account → Voice & audio → Notifications → Screen sharing with an unsaved profile edit. | The same modal, menu, titlebar, language picker and content alignment remain. Draft survives switching. Audio tests stop on exit. | Pending |
| Language focus | Open settings with the mouse, then navigate with the keyboard to the language selector. | Initial focus is on the settings heading. No automatic red outline surrounds the language selector. Keyboard focus still has one visible indicator. | Pending |
| Account required | Sign out, relaunch, and attempt an old room link or local-entry URL. | Sign-in is required. There is no Continue without account option. Existing local data remains. Room invitation survives sign-in routing. | Pending |
| Google sign-in | Start Google sign-in; finish in the browser. Test an existing device and a first-time account, including an account with no saved backup. | Browser comes forward, then Vumiro comes forward and enters lobby. While loading account data, auth shows Signing you in, never Your account or email/password setup. Temporary account-data failure offers Retry. A different device with an encrypted existing identity still requires genuine recovery. | Pending |
| Native resizing | Restore the window from maximized; drag all edges/corners, including with Settings open. | Windows resize cursors and dragging work independently of WebView/dialog content. Maximized/fullscreen sizing remains standard Windows behavior. | Pending |

## Checks already performed

Fourth-pass checks in the actual Windows app confirmed:

- QA friend/avatar, room/card-padding and desktop/inbox activation reached their destinations. Keep editing kept both the checkbox draft and enabled popup; retrying with Discard restored the saved value and navigated. A QA incoming-call host event focused Accept without accepting it.
- The actual native popup appeared while LOCAL QA was minimized. Sending native mouse messages to its avatar restored LOCAL QA and opened the inbox. This exercised the native popup click handler and host bridge together, without accepting a call.
- 45 form submissions completed locally in 75ms (9ms to submit), with all 45 shown, no cooldown warning and a newer draft intact. This was a solo QA room; automated paired-channel tests cover burst receiving.
- With a 364px track, short overflow produced a 218.4px thumb (60%) and a long log produced 72.8px (20%). Dragging reached the full 4016px scroll range; native wheel input moved 100px. Opacity measured 0 → 0.74 → 1 → 0.30 → 0. Empty content hid the thumb.
- Opening settings focused its heading, with both language control outlines computed as `none`. CSS retains a single `:focus-visible` indicator for keyboard access.

Independent review found no actionable issues. The official launcher passed **485/485**, all native gates and a build with no warnings/errors. Commits: `2eb1232` (settings focus), `98e2484` (instant chat), `23e44cd` (popup actions), `b812fbf` (bounded thumb and shared assets).

Third-pass checks against the actual Windows LOCAL QA WebView confirmed:

- A popup remained in the top layer and was hit-testable above Profile settings; it moved above the settings exit prompt.
- Keep editing preserved a temporary unsaved profile draft. Discard restored the saved value, closed settings and focused the incoming call's Accept button. No real call was accepted or profile change saved.
- The bell bottom was 102.75px and list top was 115px; the bell remained hit-testable and the next click closed the list.
- A real mouse drag increased chat from 556px to its 694px limit at a 2316px room viewport. Red thumb opacity was measured at 0 → 0.74 → 1, then 0.30 → 0, proving both fades.
- Restored authentication entered the lobby. Fresh Google/no-backup and retry paths passed provider-fixture regressions; the screenshot's persistent missing redirect was not reproduced with a real provider session. The confirmed management-screen flash was removed, and no-backup completion now explicitly routes to the lobby. Real browser sign-in remains a human QA gate.

Independent review found no actionable regressions. The official launcher passed 462 client tests, native invariants, notification payloads, nudge/resize, local-service isolation, updater, audio recovery and diagnostics checks.

Second-pass native QA confirmed click-only bell activation, synchronous room loading/cancellation and successful child connection handoff. Profile/Account/Audio/Notifications/Screen sharing retained the same dialog, navigation and language picker; content left edge and width remained equal (960 CSS pixels at the checked viewport), and an unsaved profile draft survived navigation.

A probe against the actual LOCAL QA window observed 15 distinct native window bounds during a nudge, exact original bounds on completion, and no foreground change. It detected the monitor-sized click-through glow and its cleanup. All eight native edge/corner hit tests reached the form instead of the WebView child. Manual drag feel, actual Google browser-to-app focus, desktop popup activation and real two-client nudge delivery remain for human acceptance.

Linux X11 supports native effects; Wayland and ordinary browsers use a viewport glow because arbitrary native window/monitor positioning is unavailable.

## Named-tag rollout status

After the user's release authorization on 2026-11-10, both existing coordination Workers were deployed. Reconnecting the real LOCAL QA client received **`qa-masta#92374`** from the live directory. The earlier numeric-only service limitation is resolved. Commit `e046dbb` still protects cached named tags during older directory responses.

Backend regressions cover named lookup, collision handling and reconnect persistence. Real two-person lookup and final cross-client acceptance remain part of human QA.
