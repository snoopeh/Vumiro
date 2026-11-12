# Community Hub UI implementation plan

Goal: make reading, chatting, joining voice and editing channels immediate and coherent.
Architecture: preserve model/service contracts; split visual primitives into community-ui.js; reshape the workspace controller around persistent navigation/chat/voice regions. Vanilla JS, Shadow DOM, shared Windows/Linux assets.
Spec: DESIGN.md. Existing source critique: UI-REVIEW.md.

## Tasks
- [x] Visual primitives: add semantic button variants, safe SVG icons and a shared layout stylesheet module; wire into every host/bundle. Verify slot safety and all showcase themes.
- [x] Conversation shell: replace dashboard tabs with channel header and scoped settings overlay, anchored composer/history, reader scroll preservation, keyboard send and a narrow channel drawer. Write failing interaction tests first.
- [x] Navigation/voice: group Spaces, contextual plus/gear dialogs, inline voice join and retained participant state with persistent dock. Preserve identity/cleanup and backend authorization. Write failing interaction tests first.
- [x] Studio/homes polish: group creator controls into comprehensible sections; truthful local/shared save copy; calm hierarchy, restrained showcase decoration and destination cards.
- [ ] Run focused checks, independent review, then the complete native/client gate once stable. Inspect and iterate in real LOCAL QA at desktop/narrow widths. Commit explicit owned paths only and record readiness/limits.

## Ownership
Root: community-workspace.js, its tests, shared shell/asset wiring, documentation and native QA.
Visual worker: community-ui.js and tests/community-ui.test.mjs only.
Theme worker: community-themes.js, community-studio.js, their tests and creator-kit docs only.
Workers share checkout and must preserve others' edits; no worker commits.

## Verification and handoff

Source implemented with 31 workspace interaction regressions covering keyboard composition, independent voice/drafts, contextual editing, readable access, admission, identity cleanup, message reading position and earlier-history event ordering. Theme/Studio/visual primitive checks are registered with the chat group.

Integration review found and fixed synchronous mute-state inversion, Shadow DOM focus trapping, hidden asynchronous errors, and earlier-history anchoring before transport callbacks. Windows LOCAL QA inspection confirmed the compact navigation, channel tree and anchored conversation shell; final desktop/narrow visual acceptance remains incomplete after the user stopped Computer Use. No visual acceptance or live SFU/device validation is claimed.

Final full verification command for the commit: `node scripts/Check-Client.mjs --native --output dist/community-ui-final-checks`. The receipt records exact totals, status and source fingerprint. User requested committing these current changes, merging into the primary checkout branch and pushing source. This is not a production release or deployment.
