# Room Message Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ggcoder:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people reply to a verified room text message by dragging its row to the composer or activating Reply, while keeping older clients able to read the text.

**Architecture:** Extend the existing signed v2 chat envelope with a separately signed, optional `replyTo` reference. Keep room-local selection and rendering in `call-client.js`, and add only the small preview/drag styles and markup to `call.html`. Reuse the bounded verified chat history as the target index.

**Tech Stack:** WebView2-hosted HTML/CSS/JavaScript, browser WebRTC data channels, Node `node:test` VM harnesses.

**Spec:** `docs/superpowers/specs/2026-11-09-room-message-replies-design.md`

---

### Task 1: Signed reply extension

**Files:** `Vumiro.Client/WebServer/call-client.js`, `tests/room-chat.test.mjs`

- [ ] Write failing tests for the v2 reply extension: local signing and history preservation; incoming valid reference; tampered ID/author/signature rejection; missing half of extension rejection; plain v2 compatibility; room reset.
- [ ] Run `node --test tests/room-chat.test.mjs` and confirm failures describe missing reply behavior.
- [ ] Add bounded `validReplyTo`, `chatReplySignatureText` with a distinct domain, separate `replySignature` verification, and `storeChatMessage` preservation. Keep the original `chatSignatureText` untouched. Resolve references only by author ID plus message ID in current-room verified history. Use no peer-supplied excerpt.
- [ ] Run the focused test and `node --check Vumiro.Client/WebServer/call-client.js`; fix until green.
- [ ] Commit only protocol and test files: `feat: sign and retain room reply references`.

### Task 2: Reply selection and rendering

**Files:** `Vumiro.Client/WebServer/call-client.js`, `Vumiro.Client/WebServer/call.html`, `tests/room-chat.test.mjs` or focused `tests/room-replies.test.mjs`

- [ ] Write failing tests for Reply button, draft-preserving selection/replacement, Escape/Cancel, send reset, room reset, one-level citation rendering, missing-original fallback, and disabling targets when 100-message history evicts them.
- [ ] Run focused tests and confirm expected failures.
- [ ] Add a preview above `#chatText` and a Reply control to verified retained text rows. Render only bounded text with DOM text nodes; cite a verified target, focus/scroll to it when present, and show unavailable otherwise. Clear pending selection after successful send and room change. Keep file/system/legacy rows ineligible.
- [ ] Run focused tests, syntax check, and `node --test tests/room-chat*.test.mjs`.
- [ ] Commit only UI, behavior, and test files: `feat: compose and display room message replies`.

### Task 3: Row drag and release checks

**Files:** `Vumiro.Client/WebServer/call-client.js`, `Vumiro.Client/WebServer/call.html`, `tests/room-replies.test.mjs`

- [ ] Write failing tests for row drag/drop onto the composer, outside/cancel drops, interactive-child and active-selection cancellation, and evicted-row drag disabling.
- [ ] Run focused tests and confirm expected failures.
- [ ] Make eligible rows native draggable. Carry only an opaque room-local token through `dataTransfer`; handle `dragstart`, `dragover`, `drop`, and `dragend`. Highlight a valid composer drop target without changing the draft until drop. Keep Reply button as the click/tap/keyboard action.
- [ ] Run focused tests, syntax, and full `node --test tests/*.test.mjs`; run `node scripts/Check-Client.mjs --skip-backend` if the suite passes.
- [ ] Commit: `feat: drag room messages into reply composer`.

### Task 4: Human QA handoff

**Files:** design verification record, optional focused fix files

- [ ] Launch `./scripts/Run-Local.ps1` from the feature checkout, examine its logs and `dist/local-qa/launch.json`, and verify the LOCAL QA window title.
- [ ] Inspect the UI with one and two peers if available. Leave live multi-client, mixed-version, and touch findings explicitly pending if not observed.
- [ ] Record verified checks and limitations in the design, commit the note, and hand off for human review. Do not bump versions, push, deploy, or release.
