# QA feedback checklist

Use the **LOCAL QA** window from `Local QA.cmd` or `./scripts/Run-Local.ps1`. Record Pass/Fail and any reproduction steps in the Result column. This checklist does not authorize a push or release.

Automated baseline: the full client suite passed **412/412**. Subsequent focused checks passed **16/16** for motion/Linux and **9/9** for localization/bundling, including two new native-minimize checks. Backend directory tests passed **29/29**. The final Windows build completed with **0 warnings and 0 errors**. Human QA remains pending.

| Check | Action | Expected behavior | Result |
| --- | --- | --- | --- |
| Sender popup | Generate an incoming notification with a known friend. | Popup shows the correct sender name, avatar, and activity. Dismiss works; no call is accepted automatically. | Pending |
| Minimized desktop popup | Open **Settings → QA notification tests → Test desktop popup in 3 sec**, then minimize within three seconds. Click the desktop popup. | A desktop popup appears while minimized. Clicking the QA sample restores LOCAL QA and opens notifications. Real live notifications open their still-valid target without automatically accepting a call. | Pending |
| Bell drawer | Hover or keyboard-focus the bell; move away. Click the bell, then try Escape and an outside click. | Hover/focus opens a sliding preview; leaving closes an unpinned preview. Clicking pins the drawer. Escape/outside click closes it. | Pending |
| Chat scrollbar | Scroll a chat with enough messages; hover and keyboard-focus the chat, then stop interacting. | Scrolling works normally. Track stays transparent. Only a red thumb appears during hover, focus, or scrolling; it hides when interaction ends. | Pending |
| Room connection | Join a room. Repeat with an unavailable connection; try **Cancel** and **Try again**. | Connection screen reflects actual joining/reconnecting. A successful join dismisses it. Errors/slow connection offer recovery; Cancel leaves the attempt and Retry starts a fresh attempt. Password entry stays accessible. | Pending |
| Launch reveal | Close and relaunch a signed-out LOCAL QA window. Try **Skip intro**, then navigate internally back to sign-in. | Approved reveal starts from black and transitions into sign-in. Skip immediately enables the form. Internal navigation does not replay the reveal. Launch tracking uses session storage for that app session. | Pending |
| Login petals | Watch the sign-in screen; use **Pause petals** and **Resume petals**. Hide and restore the window. | Petals stay behind the form, do not block input, pause on request/while hidden, and resume appropriately. | Pending |
| Reduced motion | Enable the system reduced-motion preference, then open sign-in and receive a nudge. | Intro is skipped; petals are hidden. A nudge uses the yellow glow without shaking. | Pending |
| Settings exit | Change a setting, move between settings sections, and attempt exit using Escape, Close, and Back. Exercise **Save changes**, **Discard changes**, and **Keep editing**. | Dirty drafts prompt consistently across sections. Save persists changes; Discard restores saved values; Keep editing preserves drafts. Failed saving retains the draft and open settings. Clean settings close immediately. | Pending |
| Six languages | Select **English**, **Español**, **Português (Brasil)**, **日本語**, **简体中文**, and **Русский**. Reopen the app and check an embedded room. | Autonym choices are discoverable on sign-in and in the app. Explicit selection persists and updates the room. User names/messages, drafts, and focus are preserved. Human linguistic review is still required. | Pending |
| Friend nudge | Use **two updated clients**, online as mutual friends. Send a nudge, then try another within 30 seconds. | Receiver gets one short app-content shake, without sound or focus stealing. Sender reports delivery only after acknowledgment. Cooldown prevents repetition. Real two-peer human QA remains pending despite passing transport unit tests. | Pending |
| Nudge preferences | On the receiver, enable **Silent mode**, receive a nudge, then disable **Allow nudges** and retry after cooldown. | Silent mode gives a feathered yellow inset glow instead of shaking. Disabled nudges produce no effect and are not reported as delivered. Repeated effects do not extend the 900ms duration. | Pending |

## Checks already performed

Native visual inspection confirmed upper-right window controls, the login petals, reachable language selectors, the settings confirmation prompt, the notification drawer, and the room reconnect screen. Language switching preserved a test password draft; settings Discard restored saved nudge preferences. Desktop popup activation and real two-client nudge delivery still require human acceptance.

## Named-tag rollout status

The running service was checked: its `ready` / `profile-ready` responses lack `namedFriendTagsVersion` and a named handle. **Named tags are not verified working on the running service.** Backend source supports them, but rollout is held pending human signoff. Commit `e046dbb` fixes the client regression that erased an already cached named tag when a numeric-only ready response arrived.

After an approved rollout, separately verify that the directory assigns a `nickname#code` handle, lookup resolves it, and reconnect preserves it. Do not use the cached-tag fix as evidence of backend rollout or successful handle assignment.
