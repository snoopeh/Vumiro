# Stream Mosaic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ggcoder:subagent-driven-development (recommended) or ggcoder:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display active room streams as a responsive, uncropped mosaic while keeping voice-only participants accessible.

**Architecture:** A pure planner scores bounded CSS Grid configurations from scene size and intrinsic video ratios. Existing tile nodes move between a stream grid and compact participant strip; focus selects controls rather than sizing. Resize events recompute local layout.

**Tech Stack:** Existing WebView2/Electron HTML/CSS/JavaScript, Node test runner.

**Design:** `docs/superpowers/specs/2026-11-09-stream-mosaic-design.md`

---

### Task 1: Geometry planner

**Files:** `Vumiro.Client/WebServer/call-client.js`, `tests/call-layout.test.mjs`

- [ ] Add tests for one wide stream, two wide streams in wide/narrow scenes, three and four streams, portrait content, missing video dimensions, and finite bounded results.
- [ ] Run `node --test tests/call-layout.test.mjs` and confirm the new tests fail because the planner is missing.
- [ ] Add `planMosaic` as a pure function. For candidate column counts 1..min(4,n), score contained video area. Return columns and row height; favor fewer columns on ties. Clamp invalid ratios to 16:9 and narrow scenes to one column.
- [ ] Run the focused tests and commit this slice.

### Task 2: Room tile integration and responsive CSS

**Files:** `Vumiro.Client/WebServer/call-client.js`, `Vumiro.Client/WebServer/call.html`, `tests/call-layout.test.mjs`

- [ ] Add a failing DOM-level test for moving the same tile nodes between stream grid and voice-only strip on sharing changes; assert stable order, no duplicate nodes, and focused control state.
- [ ] Add the two containers inside `#tiles`, the DOM updater, CSS Grid styles and compact strip styles. Keep `object-fit: contain`, Actual size scrolling and fullscreen.
- [ ] Re-plan on scene width, viewport height and video intrinsic-size changes. Bound min row height so small windows can scroll. Dispose the observer at unload.
- [ ] Run focused tests, syntax checks and the client suite. Inspect diff for unrelated staged hunks; commit only this task's hunks.

### Task 3: Local QA handoff

**Files:** update the design record with evidence if needed.

- [ ] Launch `scripts/Run-Local.ps1` and verify `dist/local-qa/launch.json` and the open window identify this checkout with `LOCAL QA`.
- [ ] Check the clean source diff for the mosaic commits and report remaining risks, especially the unrelated application-audio leak.
- [ ] Give the user the live LOCAL QA window and a concise one-to-four-stream review checklist. Human acceptance and final release signoff remain pending.
