# Local app and human QA

Double-click **Local QA.cmd** in the repository, or run:

```powershell
./scripts/Run-Local.ps1
```

This checks JavaScript syntax, runs the fast client/native regressions, builds the Windows host incrementally, and opens the real app from `dist/local-qa`. It waits for the host to report a loaded interface and stops with a log path if checks, building or startup fail. Install the .NET 9 SDK, .NET Framework 4.8 targeting pack, Node.js 22 or later, and the Edge WebView2 Runtime first.

The window and title bar say **LOCAL QA** with the source commit and a working-tree marker. It reads HTML and JavaScript directly from `Vumiro.Client/WebServer` and disables the browser cache. After editing these files, click **Reload UI**. Reloading ends that QA window's room. After C# or project changes, rerun the launcher; it closes only this checkout's previous QA process and rebuilds it.

The LOCAL QA window exits when closed rather than staying in the tray. Its profile, signing identity, contacts, preferences and encrypted account session are separate from the installed app, under `%LOCALAPPDATA%\Vumiro\LocalQA\<checkout-id>`. The profile persists across QA launches. Nothing is imported from the installed app. Native capture and account sign-in use the normal host, with the existing backend by default. Avoid starting two OAuth sign-ins at the same time because the native callback uses one fixed loopback port.

The update screen explains that this is a local checkout; release checking and installation are disabled. Only Debug builds recognize the launcher's development overrides. Release builds keep their normal origin, paths and updater behavior.

For repeated presentation-only edits after relevant checks pass, the shorter launch is:

```powershell
./scripts/Run-Local.ps1 -SkipTests
```

This still checks JavaScript syntax, builds and verifies startup. Usually Reload UI is faster and needs no terminal command.

Logs are in `dist/local-qa/logs`; `dist/local-qa/launch.json` identifies the executable, process, source and profile. The matching `local-qa-status.json` in the isolated data folder records native interface startup. These files help diagnose startup; they do not prove every product flow works.

## Working agreement

1. Implement one small change and run its relevant checks.
2. Open LOCAL QA and give the user a short acceptance checklist.
3. Fix problems locally and reload. Stay on the existing release version while work is in progress.
4. Once human QA is accepted and the user asks to ship, commit/push final source and use the [Ship command](RELEASING.md). CI builds, verifies and publishes the release, then writes one final report.

Ordinary source commits/pushes do not require a release. Do not use public releases as a way to deliver unfinished builds for human QA.
