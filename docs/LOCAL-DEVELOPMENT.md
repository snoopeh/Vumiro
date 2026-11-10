# Local app and human QA

Double-click **Local QA.cmd** in the repository, or run:

```powershell
./scripts/Run-Local.ps1
```

This checks JavaScript syntax, runs the fast client/native regressions, builds the Windows host incrementally, and opens the real app from `dist/local-qa`. It waits for the host to report a loaded interface and stops with a log path if checks, building or startup fail. Install the .NET 9 SDK, .NET Framework 4.8 targeting pack, Node.js 22 or later, and the Edge WebView2 Runtime first.

Run from this exact repository checkout. Use [the feature map](FEATURE-MAP.md) to find owning files and [the context workflow](CONTEXT-WORKFLOW.md) for focused checks and compact handoffs. The default launcher invokes `Check-Client.mjs` once with `--skip-backend --native`; it runs the complete client suite and the seven existing native regression projects without cache reuse. Backend changes also need the default `node scripts/Check-Client.mjs` client/backend checks.

During iteration, select a feature or changes since a Git ref:

```powershell
node scripts/Check-Client.mjs --group streaming --skip-backend --plan
node scripts/Check-Client.mjs --group streaming --skip-backend
./scripts/Run-Local.ps1 -Group streaming -ChangedSince HEAD
```

`-Group streaming,friends` combines feature groups; `-ChangedSince` adds staged, unstaged and untracked changes to changes since that ref. Unknown/shared paths fall back to the full suite. Omit both options for the normal full human QA handoff. To reuse matching eligible Node check receipts locally, pass `--reuse` to the checker or `-ReuseChecks` to the launcher. Native and backend checks always run fresh. Record reused results as reused and retain the source fingerprint/receipt; CI, tag and release checks must not use cached results.

The window and title bar say **LOCAL QA** with the source commit and a working-tree marker. It reads HTML and JavaScript directly from `Vumiro.Client/WebServer` and disables the browser cache. After editing these files, click **Reload UI**. Reloading ends that QA window's room. After C# or project changes, rerun the launcher; it closes only this checkout's previous QA process and rebuilds it.

The LOCAL QA window exits when closed rather than staying in the tray. Its profile, signing identity, contacts, preferences and encrypted account session are separate from the installed app, under `%LOCALAPPDATA%\Vumiro\LocalQA\<checkout-id>`. The profile persists across QA launches. Nothing is imported from the installed app. Native capture and account sign-in use the normal host, with the existing backend by default. Avoid starting two OAuth sign-ins at the same time because the native callback uses one fixed loopback port.

The update screen explains that this is a local checkout; release checking and installation are disabled. Only Debug builds recognize the launcher's development overrides. Release builds keep their normal origin, paths and updater behavior.

For repeated presentation-only edits after relevant checks pass, the shorter launch is:

```powershell
./scripts/Run-Local.ps1 -SkipTests
```

This still checks JavaScript syntax, builds and verifies startup. Usually Reload UI is faster and needs no terminal command.

Read `dist/local-qa/checks/checks-report.md` or `checks-report.json` first; inspect only the named log when a check fails. The launcher's check summary, build and startup logs are in `dist/local-qa/logs`; `dist/local-qa/launch.json` identifies the executable, process, source and profile. The matching `local-qa-status.json` in the isolated data folder records native interface startup. These files help diagnose startup; they do not prove every product flow works.

## Review local signaling changes

For changes to friend tags, discovery or room signaling, start the local Worker in a separate terminal:

```powershell
cd cloudflare
npm run prepare-assets
npx wrangler dev --config wrangler.storage.jsonc --ip 127.0.0.1 --port 8787 --local --persist-to ../dist/local-qa/worker-state
```

Then launch the native app from the repository root:

```powershell
./scripts/Run-Local.ps1 -LocalService
```

The launcher checks the local listener before building or closing an existing QA window. This session shows **LOCAL SERVICE** beside its LOCAL QA badge and routes discovery and room signaling to `127.0.0.1:8787`. Local peers must use that same Worker; they cannot discover installed users through it. Its Durable Object state stays in the local persistence folder. Account sign-in is unavailable on this isolated signaling Worker.

The override applies before page scripts on every native document, including navigation through sign-in, and takes precedence over the QA profile's saved service. It does not replace that saved preference. Launch again without `-LocalService` to use the saved or normal service. Only an explicit LOCAL QA session accepts the development override, restricted to loopback WebSocket URLs at `/call-signaling`. Release builds ignore it. The launch receipt records the active `signalingOverride`.

## Working agreement

1. Implement one small change and run its relevant checks.
2. Open LOCAL QA and give the user a short acceptance checklist.
3. Fix problems locally and reload. Stay on the existing release version while work is in progress.
4. Once human QA is accepted and the user asks to ship, commit/push final source and use the [Ship command](RELEASING.md). CI builds, verifies and publishes the release, then writes one final report.

Ordinary source commits/pushes do not require a release. Do not use public releases as a way to deliver unfinished builds for human QA.
