# Focused work and verification

Run commands in the exact Vumiro checkout. Start with [FEATURE-MAP.md](FEATURE-MAP.md), identify the owning source and checks, and inspect those files plus necessary dependencies. Use bounded searches and reads; expand only when evidence crosses a boundary.

## Iteration and handoff

```powershell
# Inspect the selected work without running checks.
node scripts/Check-Client.mjs --group streaming --skip-backend --plan
# Run a feature's checks; repeat --group to combine features.
node scripts/Check-Client.mjs --group streaming --skip-backend
# Include committed changes since a ref and current staged/unstaged/untracked work.
node scripts/Check-Client.mjs --changed-since HEAD --skip-backend
# Explicit local reuse of eligible passing checks.
node scripts/Check-Client.mjs --group streaming --skip-backend --reuse
```

The default `node scripts/Check-Client.mjs` runs the full client/backend suite without reuse. Unknown or shared changes conservatively select the full suite. Add `--native` for the selected native regressions; backend and native checks always run fresh. Focused checks aid iteration; use the default [LOCAL QA launcher](LOCAL-DEVELOPMENT.md) for the full client/native human QA handoff. CI, tag and release validation must run without cached results.

Read `checks-report.md` or `checks-report.json` first. Successful checks need only their command, result and receipt path in the handoff. On failure, open the named log and relevant source; avoid loading passing logs or repeatedly rerunning a passing broad suite. Reports and logs default to `dist/checks`; the launcher uses `dist/local-qa/checks` plus build/startup logs in `dist/local-qa/logs`.

## Source fingerprints and receipts

A check result applies to its recorded checkout inputs and execution context. JSON receipts identify the checkout root, revision (`source`), working-tree `fingerprint`, selection `scope`, runtime/environment identity and check results. Each result records its command, working directory, log, duration, `reused` status and original `verifiedAt`. The fingerprint conservatively covers tracked and nonignored checkout inputs, including additions and deletions; generated build/dependency directories are excluded. Even an unrelated source edit invalidates reuse. Symlinks disable reuse. Local reuse also records Git/PowerShell versions and the OS version, since Node regressions can use those tools. A commit SHA alone cannot describe uncommitted work. Selection and source freshness are separate: a focused passing receipt does not imply full-suite coverage.

`--reuse` accepts only eligible passing results with a matching fingerprint and execution context. A changed input, command or runtime/environment invalidates reuse; failed or unreadable receipts must run again. The full environment is hashed; raw environment values are not stored. Only the Node version/syntax/client checks are eligible. Native/backend checks depend on external toolchains and installed dependencies and always run. A reused result is prior evidence for matching recorded inputs: say **reused**, never **freshly tested**. Receipts cannot establish hardware behavior or human acceptance.

Keep handoffs compact and concrete:

```text
Checkout: absolute path; branch and revision
Source: recorded working-tree fingerprint; relevant changed paths
Scope: feature groups and reason for any full fallback
Checks: exact commands; fresh/reused/failed; report and log paths
Limits: omitted checks, unresolved concern, human QA still required
Next: specific action or short acceptance checklist
```

When delegating, send a fresh brief with the goal, exact checkout, owned files, relevant contracts, known findings, required checks and acceptance criteria. State that other agents share the checkout and their edits must be preserved. Return concise findings and artifact paths; include source excerpts only when needed to explain a decision.

## Release handoff

Read `docs/RELEASING.md` only when preparing an accepted release. Hand over the clean, pushed source revision, QA acceptance, intended version bump and exact Ship command. After CI completes, read its single `release-pipeline-report` summary; inspect only a named failed job's log. A focused receipt does not authorize publication or replace the full uncached release gates. Store downloaded reports under `dist/` so they do not become source inputs. An independent release agent needs this brief and the release guide, not the implementation conversation.
