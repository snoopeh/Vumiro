# Attention, Friends and server foundations

**Goal:** Match the incoming-call card to Vumiro's gray palette, restore a distinct Friends overview, keep conversations clean, deliver desktop corner alerts, and make a usable local server sandbox.

**Design:** Friends manages contacts and requests; Conversations uses the People list beside a selected persistent direct chat. Calls stay in conversation headers. Support is accessible above the sidebar profile. Servers opens an explicitly local sandbox with channels, member previews, saved messages and small management controls. Its storage adapter is separate from rendering so a later authenticated self-hosted or managed service can implement the same operations. Simulated membership never becomes real friend presence, and voice does not pretend to connect.

**Attention:** A maximized or fullscreen Vumiro window receives the same bounded shake as a normal window. Another foreground fullscreen application suppresses window movement and receives the brief nonactivating yellow edge cue on its monitor. Yellow is reserved for this case. Silent/reduced-motion settings retain a neutral nonmoving alternative. Normal desktop alerts are nonactivating native corner windows; browser-only sessions retain in-app fallback. Incoming calls keep their centered actionable card without duplicate foreground desktop alerts.

User has authorized autonomous design and implementation. Work remains in this exact shared checkout, preserving existing uncommitted account, chat, gaming and icon work. No release, deployment or version change is included.

- [x] Trace card palette and notification/attention routing.
- [x] Add behavioral regressions for attention and external desktop routing, then implement fixes.
- [x] Restore Friends/Conversations navigation and Support entry; preserve room, gaming, settings and draft transitions.
- [x] Build identity-scoped sandbox persistence and UI with channel/member/management tests.
- [x] Register and bundle the server module for all shared clients; add localization for app-authored labels.
- [ ] Review cross-feature navigation and data isolation, run focused checks and full native launcher, then inspect LOCAL QA.
