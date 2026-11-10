# Context-efficient checks

Goal: localize discovery and iteration while retaining complete integration and release checks.

The user approved implementation of the proposed feature index, focused groups, compact handoffs, reusable verification, and narrower guidance on 2026-11-10. Work in the existing clean Vumiro checkout; do not modify sibling worktrees or publish releases.

## Design

- A versioned feature catalog maps source paths to test groups and native checks. A small planner selects explicit groups or changes since a Git ref, including staged, unstaged and untracked files. Unknown or shared changes fall back to all checks. Renames include both paths.
- The existing Check-Client entry point retains full uncached checks by default. Opt-in focused execution writes compact JSON/Markdown receipts and logs. Cache keys include checkout inputs, command, runtime and environment; only passing checks can be reused, never in CI or release/tag checks.
- The local launcher accepts feature groups and optional cache reuse through this entry point, preserving the existing full native QA handoff by default.
- Feature guidance documents ownership, dependencies, commands and acceptance. Handoffs use revision, working-tree fingerprint, commands, result, limitations and artifact paths. Prefer the exact checkout, bounded reads and concise subagent briefs.
- Keep app refactoring incremental. Establish real module boundaries in the check tooling now; isolate a safe app extraction only with evidence and regression coverage.

## Slices

- [x] Planner/catalog: selection, dependency expansion, conservative fallback, regression tests.
- [x] Runner/receipts: scoped execution, content fingerprints, cache invalidation, compact failure output and tests.
- [x] Launcher/docs: native integration, feature map, scoped instructions and handoff contract.
- [x] First app boundary: extract the existing mosaic IIFE unchanged into `stream-mosaic.js`, test it directly and retain the frozen release file set through bundling. Update Linux/Worker copy and trusted routing paths.
- Verification authority: run `node scripts/Check-Client.mjs --native` and read generated `dist/checks/checks-report.json`. Use a separate `--output dist/focused-chat` when demonstrating focused reuse so the full receipt is retained. Exact results belong in runtime receipts and the final handoff, not permanent source claims.

## Validation

Behavioral tests cover unknown paths, shared inputs, groups, Git changes and deletions; real temporary-repository runner tests cover first run, reuse, edited/deleted inputs, failed checks, changed environment, and CI/tag cache bypass. Existing pipeline/report tests must remain passing. No release version, remote source or production service changes are required.
