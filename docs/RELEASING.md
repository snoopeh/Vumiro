# Local QA, checks and releases

## Daily work

1. Open the real Windows app with **Local QA.cmd** or `./scripts/Run-Local.ps1`.
2. Edit shared web assets and click **Reload UI**. Rerun the launcher for native changes.
3. Run focused checks while fixing a problem. Before handoff, use the launcher or the full fast check below.
4. Have the user accept the change in LOCAL QA. Source commits and pushes can happen without publishing a release.

```powershell
node scripts/Check-Client.mjs
```

Install backend dependencies once with `npm ci --prefix cloudflare`. The checker stops at the first failed stage and writes a compact result plus full logs under `dist/checks`. Use `--skip-backend` for client-only iteration after relevant backend checks have passed. This command does not build the native Windows host; the local launcher and Windows CI handle that.

## Ship an accepted change

Commit and push the accepted source to `main` first. Keep the existing release version throughout implementation and human QA. Preview the next release:

```powershell
./scripts/Ship.ps1 -Bump patch
```

Preview only reads local state; it does not contact GitHub or change files. It displays any local blockers. `minor` and `major` are also supported.

After human QA acceptance and an explicit request to release:

```powershell
./scripts/Ship.ps1 -Bump patch -Publish -QaAccepted
```

The command requires a clean `main`, matching Windows/Linux versions, the configured Vumiro origin, remote `main` equal to local HEAD, and an unused next tag. It checks JavaScript syntax, updates all five version values across four metadata files, creates a release commit and annotated `client-v*` tag, then pushes those two refs atomically. A failed push preserves local work and prints recovery commands. Inspect those commands and remote state; do not force push, reset, or create a second version to recover.

Shipping the source starts GitHub Actions. The hosted release is ready only when the release pipeline succeeds.

If a tagged run fails and needs a source fix, preserve that tag. Commit and verify the fix on `main`, then ship the next patch version. A failed unpublished tag is not a published release; do not move it or force push to reuse its version.

## What GitHub Actions does

| Trigger | Automated work |
|---|---|
| Relevant source push or pull request | Version/syntax checks, client and backend regressions, Windows Release build and native checks, unpacked Linux build and offline UI smoke |
| `client-v*` tag | Same fast gate, Windows update packages, Linux AppImage/DEB/RPM, package checks, draft upload, remote verification, publication, updater-feed verification |

Fast checks finish before native/package jobs start. Ordinary source pushes do not create distribution archives or releases. Dependency and Electron caches reduce repeat downloads. New source runs cancel superseded runs; release runs queue rather than interrupt publication. Only the publication job has repository write permission.

### Package and publication checks

- Windows: exact legacy/complete manifests, executable versions, updater compatibility, archive limits, SHA256 manifests, and packaged HTML/JavaScript compared with source.
- Linux: all three distribution files and hashes; the packaged Electron app starts under Xvfb with disposable storage, blocked network access and denied media permissions.
- UI smoke: signed-out account gating, synthetic account authentication through the packaged account client, automatic local profile creation, offline contact import, inspection-card nickname editing at a narrow width, profile backdrop dismissal, room UI readiness and exit cleanup, packaged resource loading, and secure-store behavior without saved credentials.
- Before publication: all seven required files must exist; their sizes, hashes, manifests, draft metadata and release-tag source SHA must agree.
- After publication: verify public metadata, download and hash the complete Windows package and manifests, confirm GitHub's hashes for all files, and check the release discovery endpoints used by Windows and Linux.

A retry can resume an unpublished draft. Draft verification rejects publishing an older version when a newer stable release exists. A public release's files are never overwritten by this workflow; a rerun verifies the existing release. Public verification can fail after publication, for example if a discovery endpoint is stale. The workflow retries feed visibility a bounded number of times, then reports failure. Inspect that report before taking action.

### Reports

Open the [release workflow](https://github.com/snoopeh/Vumiro/actions/workflows/client-release.yml) and read **Release pipeline** in its job summary. The final **release-pipeline-report** artifact contains the single JSON/Markdown result, source SHA, tag, stage results and links. Supporting artifacts contain detailed fast-check logs, Linux smoke output and package verification results. They remain available for 14 days, or 30 days for release verification/final reports.

Read the compact report once. Inspect the named failing stage when needed. Successful CI does not need repeated agent polling or another broad check run.

## Run the packaged Linux smoke locally

On a Linux x64 desktop/build host with Node.js 22+, Electron's system dependencies and Xvfb installed:

```sh
npm ci --prefix Vumiro.Linux
node scripts/Build-Linux.mjs --unpacked
xvfb-run -a node scripts/Test-LinuxSmoke.mjs
```

The smoke test uses the actual `linux-unpacked/vumiro` executable and `resources/app.asar`, preserves Chromium's sandbox, times out failed startup and removes its disposable profile. It does not use real accounts or capture media. The smoke driver first checks the signed-out account gate and normal empty/unavailable secure-store behavior, then intercepts HTTPS with exact in-process account fixtures and supplies a process-memory native session adapter. The packaged preload, account client and local identity store remain unchanged; synthetic credentials never reach a network or keyring, and unexpected requests remain blocked. Building full distributions still uses `node scripts/Build-Linux.mjs`.

These checks cover startup, packaging and selected regressions. Human QA remains responsible for acceptance, including real accounts, peer connections, screen/audio capture and desktop integration on target systems.

### Keep the Linux smoke aligned with the app

When the smoke fails, review its complete route through the current handlers before rerunning CI: native startup → account gate → sign-in → hydrated lobby → contact card → nickname editor → room handshake → room exit. Check modal stacking, asynchronous readiness and cancellation together. Room UI readiness is separate from a live peer connection; the smoke deliberately blocks external signaling and media capture.

Check the Linux asset allowlist against the packaging list and every script referenced by the three entry pages. A file being bundled or read from disk does not prove that Chromium loaded it. The smoke must reject failed local resource requests, including iframe scripts, and wait for document and resource completion. Use the [Electron debugger API](https://www.electronjs.org/docs/latest/api/debugger) and [DevTools Network events](https://chromedevtools.github.io/devtools-protocol/tot/Network/) for this distinction. Queue debugger commands before the first navigation, then await readiness after navigation so startup can proceed.

Fix all confirmed mismatches in one batch, run the focused contracts locally, then validate the complete packaged flow in CI. Do not remove assertions or repeat the full pipeline to discover one stale selector at a time.
