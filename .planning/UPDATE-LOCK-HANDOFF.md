# Windows update failure — 2026-11-02

## Confirmed cause

The user's screenshot showed recovery folder `.client-backup-36084693cc0c48b488fd829645c8a290` in `Vumiro.Client/bin/Release/net48`. This was a real sharing violation, not an archive or network failure:

- Existing Vumiro 1.21.4 process **16036**, created at 14:47:40 America/Sao_Paulo, remained hidden in the tray from the same executable folder.
- A second app process **6536** started cached updater **25128** at 15:49:31. The helper waited only for 6536. Process 16036 kept `Microsoft.Web.WebView2.Core.dll` mapped.
- A read/write open without truncation confirmed Windows sharing error **32** on that DLL. The backup folder contained only that first DLL, and installed executable versions remained 1.21.4.
- Old Apply recorded a file as changed before copying. Its first copy failed without changing the target; rollback then attempted to overwrite the same locked DLL. The generic AggregateException hid the original filename and cause.
- Earlier actual published updater validation covered one app instance and missed this case.

## Fix in 1.21.6

- Windows per-user/profile named mutex and activation event prevent duplicate normal launches, restore the existing tray/window instance, and accommodate explicit isolated developer profiles. A same-folder legacy process is also detected during startup.
- App checks other processes from the same executable folder before downloading and again before staging. Helper repeats the check after the initiating process exits and avoids restarting another duplicate on failure.
- Installer skips identical files; prepares all changed file siblings and backups before committing; probes changed destinations without truncation; uses atomic replacement; records only successful commits for rollback; retries short sharing violations; keeps concrete filename/cause and genuine rollback failures visible.
- Helper writes diagnostic exception logs under `%LOCALAPPDATA%\Vumiro\Updates` without account tokens or profile contents.
- Existing 18-file compatibility bridge and 22-file complete allowlists remain unchanged. Client/helper/Linux versions match 1.21.6. No Worker change is required.

## Live repair

Failed updater 25128 was terminated after verifying its exact cached path, preventing the old error handler from launching another copy. Before repair, a fresh process query showed no Vumiro processes; the WebView DLL was unlocked. The user's remaining app had exited independently.

Built the complete 1.21.6 package at ignored `dist/repair-1216` (0 warnings, 0 errors). Ran its new shared installer in a separate .NET Framework PowerShell process against the exact original install folder while no app was running. This bypasses the old installed helper for this one repair. All **22 installed files matched SHA-256** with that full package immediately afterward. Started the repaired original app normally. User profile/friend/key storage is outside the package target and was not edited. Original recovery evidence was retained.

Ignored repair script: `dist/repair-1216/repair-installed.ps1`. It uses reflection to invoke only the packaged installer, checks for other app instances, validates the exact install path and compares resulting package hashes. It does not expose credentials.

## Scope of verification and follow-up

Source review, real process/file-lock diagnosis, package build and deployment hash comparison completed. No new tests or manual regression suite were run for this request. Existing GitHub CI runs automatically on push/tag. Publication status will be recorded below after completion.

Older installations still launch their previously installed helper for their first update. Quit all their Vumiro tray copies before retrying, or extract the complete release into a closed app folder. Once 1.21.6 is installed, both the app and helper have the new checks. Do not promise old versions acquire these protections before installing the update.

Accounts remain blocked externally: no Supabase/email/social-provider setup or operator privacy inputs yet. Keep account service and registration gates disabled. See ACCOUNT-OPERATIONS.md and the existing account handoff.

## Publication completed

- Source **10b9044** pushed to main and tagged **client-v1.21.6**.
- Main CI **41506086680** and release CI **41506093883** both succeeded for Windows and Linux. Existing automatic Windows regression/package checks passed. No extra tests were added or manually run.
- Public release: https://github.com/snoopeh/Vumiro/releases/tag/client-v1.21.6, all **7 expected assets** present. Release notes explain the actual cause, protections, diagnostic location and older-helper bootstrap caveat.
- Original repaired app is running normally as **PID8812** at the same original install path, observed after repair; no second app/helper process remained. Recheck live state rather than treating this PID as permanent.
- No Worker deployment or account-provider change was made for this repair.
