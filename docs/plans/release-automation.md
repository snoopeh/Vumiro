# Release automation delivery

## Intended outcome

Human QA uses the local native app. Deterministic scripts and CI handle routine checking, Linux builds, packaging, publication and the final result. A new public version is created only after acceptance and an explicit ship request.

## Implemented

- [x] Preview-first Ship command with aligned versions, clean Git preflight, annotated tag and atomic push.
- [x] Reusable fast version/syntax/client/backend gate before costly jobs.
- [x] Windows package verification, including shared UI/source comparison.
- [x] Automatic Linux AppImage, DEB and RPM release builds.
- [x] Offline packaged Linux startup and selected real DOM regressions under Xvfb.
- [x] Draft verification before publication and download/updater verification afterward.
- [x] One final JSON/Markdown report with logs available separately.
- [x] Lighter source CI, dependency caches, superseded-run cancellation and bounded timeouts.
- [x] Operator instructions in `docs/RELEASING.md`; local QA rules preserved.

## Validation evidence, 2026-11-05

- Full fast checker: 133 client/tooling tests and 29 backend tests passed before the final added reporting/publication regression cases; subsequent changes receive focused tests.
- Native harness: 35 desktop OAuth, caption and local QA checks passed.
- Both Windows update packages built successfully and passed package/transition/source checks. No release was published.
- Ship command: 16 disposable Git fixture tests passed under both PowerShell 7 and Windows PowerShell 5.1, including a real local bare-repository atomic push and failure recovery. Actual repository preview left all release metadata unchanged and reported its dirty worktree.
- Three workflow files passed actionlint v1.7.12.
- Reporting regression tests exercise fail-fast behavior, missing verification evidence, passing evidence and failed/skipped jobs.
- Independent integration review found an older-draft/latest regression; publication now checks for newer stable versions before promotion, covered by regression tests.

## Remaining execution evidence

The packaged Linux/Xvfb test and complete hosted publication workflow require their first GitHub runner execution after source integration. This Windows machine has no Linux runtime. Do not report that Linux execution, human QA acceptance or hosted publication has already passed. There was no source commit, push, version bump or release as part of this automation implementation.
