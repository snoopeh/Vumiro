# Local human QA plan

Goal: validate the current checkout in the real Windows host without version bumps, release tags or package publication.

Use a Debug-only local mode rather than a browser replacement (which misses native behavior) or prereleases (which retain the publishing cost). Keep the existing HTTPS virtual origin and native bridges. A launcher builds incrementally and maps shared web assets directly to source. Reload UI picks up web edits; rerunning the launcher rebuilds native edits.

- [x] Add native checks for production defaults, isolated QA paths, invalid configuration and ignored developer overrides in release mode.
- [x] Add one runtime configuration resolver; wire profile, secure account storage, preferences and singleton to the same configuration.
- [x] Add a local-only badge, reload action, startup result and disabled update installation/checking.
- [x] Add a Windows launcher with short failure output, persistent logs and exact-path restart of its own QA executable.
- [x] Document the edit/check/human-QA/release flow and persist the release gate in repository instructions.
- [x] Run relevant native checks and builds; launch the real local app and verify its startup result.
- [ ] User human QA acceptance, followed by a release request when ready.

Validation stays proportional: syntax checks and relevant regressions during edits, one full client/native pass before handoff, and package/release validation only when shipping. The QA profile uses the existing backend unless configured otherwise; local storage isolation is not backend isolation. No account data is copied from the installed app.

November 5 validation: 94 client tests and 35 native checks passed. Debug and Release builds completed with no warnings or errors. The Windows PowerShell launcher reported a loaded native interface in about seven seconds on its first run; a second run with `-SkipTests` verified exact-path restart and startup in about four seconds. An independent path audit found no isolation or release-safety blocker. The LOCAL QA window is open for user acceptance; this tooling has not been released.
