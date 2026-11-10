# Windows updater helper recovery

## Scope and decision

Priority 1C asks Vumiro to recover when its Windows update helper is missing or damaged. A current client downloads the fixed `Vumiro-win-x64-v2.zip` asset, checks its GitHub release size and SHA-256 digest, extracts only allowlisted files, and verifies both executable names and versions. It then copies the verified staged `Vumiro.Updater.exe` and config together into the disposable update cache for every update. It never launches the installed helper, whose assembly name could be valid while its contents or allowlist are stale. The helper still checks that its parent is the Vumiro executable in the target install directory before replacing files.

An otherwise complete installation with a missing or invalid helper is eligible for a same-version repair. The legacy v1 and complete v2 archive names and manifests remain frozen so older clients can traverse the existing bridge. Linux remains a manual AppImage/deb/rpm download path; this change does not alter Linux update behavior.

## Failure and threat model

- Interrupted download, mismatched size/digest, unexpected archive entry, bad executable identity/version, linked paths, or another running copy: reject before replacement. The existing installer prepares recovery copies, replaces each target, and rolls back changed files when it catches an exception.
- Missing helper, missing config, invalid assembly, malformed config, linked helper/config, or unreadable installed helper: same-version completeness stays false so a repair remains available. Every update uses the staged executable and config together after package verification, avoiding a mixed or stale pair.
- A release publisher account compromise remains a trust risk. These packages are unsigned; the digest comes from the same GitHub release authority. A process already running as the same Windows user can also interfere with the writable staging cache between verification and execution. These are existing update-channel boundaries, not solved by helper recovery.
- Process termination or power loss during file replacement can leave a mixed installation because rollback runs only when the helper catches an exception. `File.Replace` provides individual-file replacement, not an atomic multi-file transaction. A future versioned side-by-side install and stable launcher would be needed for stronger crash recovery.

## Compatibility and recovery limits

Already-shipped clients whose helper is missing or damaged still stop before downloading. New source cannot change those binaries: the user must extract the complete `Vumiro-win-x64-v2.zip` into a writable app folder and run `Vumiro.exe`. User profile and identity data are outside the app folder. Versions before the repository/executable rename may require a fresh installation for the separate reason documented in `docs/CLIENT.md`.

The patch does not change the package manifest, add an installer service, alter release metadata, sign binaries, or recover a client whose main executable cannot start. It does not claim that a successful helper handoff guarantees a successful relaunch.

## Acceptance and verification

- Focused native tests exercise copying the staged executable and config when the installed helper is absent, invalid, or valid, plus same-version repair eligibility when complete UI assets exist but the helper is absent, damaged, or has malformed config. A valid helper and config also confirm that same-version installation does not loop. The valid-installed-helper selection and malformed-config tests were observed failing before their fixes. After implementation, `dotnet run --project tests/ClientUpdateChecks/ClientUpdateChecks.csproj -c Release` passed 34 updater checks.
- `dotnet build Vumiro.Client/Vumiro.Client.csproj -c Release --nologo` and `dotnet build Vumiro.Client.Updater/Vumiro.Client.Updater.csproj -c Release --nologo` each succeeded with zero warnings and errors. `git diff --check` passed. These checks do not constitute an installed-app upgrade test.
- Before human acceptance, exercise a disposable extracted Windows installation with its helper deleted, another with a damaged helper, and a normal installation. Verify that update restarts into the expected version, preserves local identity, keeps the UI usable after a forced failed replacement, and writes a comprehensible update log. Repeat the legacy bridge-to-v2 path in an isolated copy. Do not test against the user's installed profile. Run the release package checks and LOCAL QA launcher, then record human acceptance separately from automated success.

## References

- [Microsoft `File.Replace` documentation](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.replace?view=netframework-4.7.2): individual-file replacement and same-volume constraints.
- [Microsoft Restart Manager overview](https://learn.microsoft.com/en-us/windows/desktop/rstmgr/about-restart-manager): files held open by running apps are a common update failure; the current Vumiro path requires closing other instances rather than invoking Restart Manager.
- [Electron Builder auto-update targets](https://www.electron.build/v26/docs/features/auto-update/): Linux automated update support exists, but Vumiro currently publishes manual Linux packages and does not enable that mechanism.
