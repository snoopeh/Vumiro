# Resume user-facing fixes — 2026-11-02

The user asked to pause because credits/context were running out. Resume this work before treating the older account-completion handoff as the current task. Call yourself Machine Spirit. The user authorizes autonomous fixes and delegation and dislikes repeated permission requests.

## Request and exact state

Fix missing invite link, failed latest update, add volume control inside streams, test actual audio, provide local signup/login screens, conventional maximize/close icons, remove gray outline on Alt-Tab, and check/update Git.

Changes are implemented locally and checkpointed, but **not pushed, released, installed over the running app, or deployed**. The last earlier commit was `4facec3` (account completion), preceded by `0be9a59` (handoff). At session start local main was two commits ahead of origin/main. GitHub latest was `client-v1.21.2` from `426107b`; build and release CI succeeded. Public 1.21.2 only has `Vumiro-win-x64.zip`, no v2 asset. Source targets 1.21.3.

The user explicitly answered **"No project yet"** about Supabase/transactional email. Signup/login screens exist, but real accounts remain unprovisioned. Do not claim hosted signup works. Prior account documents describe provider/legal/operations prerequisites; remote D1 migrations only 0001–0005 are applied and migration 0006 remains local.

## Implemented fixes and evidence

### Invite and stream volumes

- `Vumiro.Client/WebServer/call-client.js`, `call.html`: Invite opens a modal with full readonly/selectable link, automatic copy and visible copy/manual-copy feedback. Old link was in hidden membership panel; old fallback put it into an unselectable status line.
- Link uses public origin of signaling service; grants and passwords excluded. Friends-only mode explains the restriction and suggests Public/Private for others.
- Each remote tile has distinct Screen and Voice sliders (transceiver slots 1 and 2). Controls remain in fullscreen stage. Zero mutes, nonzero unmutes, replacement tracks reuse players and preserve levels.
- `tests/invite-volume.test.mjs`: 4/4 passed, including clipboard denied, private-link safety, independent volumes and replacement lifecycle.

### Updater and window chrome

- Actual running app was PID 5592 at `Vumiro.Client/bin/Release/net48/Vumiro.exe`, file version 1.21.3. Its directory lacked `Vumiro.Updater.exe` and config. Source launcher therefore failed on File.Copy of installed helper.
- `Vumiro.Client.csproj` now references updater with ReferenceOutputAssembly=false and copies helper/config after normal client build. Isolated build confirms both emitted. `ClientUpdates.cs` preflights missing helper before downloading and explains incomplete installs.
- `Vumiro.Client.Updater/Program.cs` removes the new v2 archive during successful cleanup.
- Published 1.21.2 ZIP SHA256 matched metadata, and its actual published installer Extract+Apply succeeded in isolated temporary folders (all 18 files). Its archive itself was valid.
- `WindowChrome.cs`: DWM border suppressed with -2, unsupported backdrop fallback margin zero, WM_NCACTIVATE avoids legacy inactive frame repaint. `friends.html`: conventional vector minimize/maximize/restore/close controls, 46px caption buttons.
- Still inspect caption accessibility label/title switching when maximizing in `friends-client.js`; native worker asked root/UI worker to add this, but it may remain undone.
- **Do not close or overwrite the user's running app without reviewing active room/media state.** Isolated packages are built and ready for later install.

### Local account screens

- `account-client.js`, `friends.html`: dedicated dialog with sign-in, signup with password confirmation, verify/resend/resume, forgotten-password/reset, account management views; sidebar/profile entry plus first-run access before local profile creation; close returns to setup.
- Unified visible status and retry for unavailable account provider; recovery code bound to account ID to avoid cross-account reuse.
- `tests/account-client.test.mjs`: expanded to 10 tests, all pass. Real browser checked first-run sign-in/create/recovery and return to setup.
- **Outstanding UI polish:** screenshots showed same unavailable message twice (#accountFeedback and #accountError), and sign-in looked enabled on config503. Root asked account worker to fix this just before pause; inspect actual diff and confirm whether completed. Worker may have stopped. Do not assume done.
- Worker tool names: `/root/account_screens_fixes`, `/root/native_update_audio_fixes`, `/root/invite_volume_fixes`; all asked to freeze/finish. Do not depend on their continued availability.

### Worker asset correction

- Root found `identity-recovery.js` was packaged but missing from Worker's request allowlist. Added to `cloudflare/worker.js`. Local requests work. No deployment done.

## Actual audio validation

1. `tests/NativeAudioSmoke` compiles the production `StreamAudioCapture.cs`. A sibling process plays an 880 Hz test tone via SoundPlayer (must be sibling: descendants are intentionally excluded by feedback protection).
2. Real process loopback captured **213 x 40ms blocks**, peak **0.010406**, matching 880Hz amplitude **0.010369**. PCM fixture at ignored `dist/audio-validation/native-capture.f32` (3,271,680 bytes, float32 stereo48kHz).
3. Root added `scripts/Test-StreamBrowser.mjs`, a real Edge/Playwright two-peer integration test against a local Wrangler Worker. It feeds that captured PCM through the production embedded call's AudioContext graph and actual WebRTC connection, measuring decoded remote RMS and inbound RTP.
4. Passed: remote RMS **0.00730**, **152 packets**, **8654 received bytes**, nonzero totalAudioEnergy. No uncaught page errors. Also passed screen volume25%, mute0%, unmute70%, invite dialog URL, actual first-run account screen navigation.

Limits: Test verifies native capture separately and production iframe PCM-to-WebRTC separately. It does not automate the entire native WebView shared-buffer bridge in one live UI test or confirm a second physical machine's speaker output. Do not overstate it.

Screenshots and result JSON at `dist/stream-validation/` (ignored): `account-signin.png`, `account-signup.png`, `account-recovery.png`, `host-room.png`, `guest-room.png`, `result.json`. Root visually inspected sign-in/signup/guest stream images.

## Validation already run

- `node --test tests/account-client.test.mjs tests/identity-recovery.test.mjs tests/invite-volume.test.mjs`: **19/19 pass**.
- `git diff --check`: pass (line ending notices only).
- Isolated Windows build via `scripts/Build-Client.ps1`: **0 warnings/errors**, includes updater.
- `scripts/Test-ClientPackages.ps1`: pass for both legacy and complete assets.
- Package folder: `dist/validation-user-fixes-20261102/`, including `Vumiro-win-x64.zip` and `Vumiro-win-x64-v2.zip`.
- Earlier backend account suite7/7 and Wrangler dry run passed in previous turn; rerun only as needed for Worker change.
- Browser test was after most UI changes; any last worker polish needs rerun only relevant checks.

## Resume steps in order

1. `git status -sb` and recent log; inspect final worker edits and this handoff. Verify checkpoint is committed, no late edits left behind.
2. Fix duplicate/unavailable account feedback and disabled submits if still present. Add maximize/restore title/aria-label switching if absent. Check account screens in real browser.
3. Add new invite-volume test to CI commands in `.github/workflows/build.yml` and client-release.yml; currently those commands only name the older account+identity suites.
4. Regenerate Cloudflare and Linux assets (`npm run prepare-assets` in each), run JS syntax checks and backend account tests; dry-run both storage and public Worker bundles because FriendDirectory lives in storage-owner script.
5. Fresh isolated package build+validator after final edits. Do not build into running app's locked folder.
6. Update user-facing docs/release notes for invite/volume/caption/update fixes and actual audio evidence. Preserve truthful account provider block.
7. **Git follow-up is still required:** fetch then push completed commits to origin/main when ready; do not say GitHub is updated until push succeeds. GitHub CLI `gh` is not in PATH, public REST via Invoke-RestMethod works; Git credentials fetched successfully. Latest CI/release APIs are `https://api.github.com/repos/snoopeh/Vumiro/actions/runs?per_page=5` and `/releases/latest`.
8. Decide bugfix release/install handoff with current session authorization. No tag, release, Worker deployment, remote migration, or app restart happened here. Previous account handoff conservatively gated all publication; desktop bugfixes could ship with account service disabled after reviewed package/CI, but do not enable public registration without Supabase and privacy inputs. User must receive updated binaries eventually for fixes to affect their running app.
9. Keep provider setup as separate unresolved work: user has no Supabase project. Need real project/SMTP/controller/contact before hosted auth works. Do not invent facts or create paid subscriptions silently.

## Reproduce browser check

Runtime Playwright is installed at `C:/Users/em_ps/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`. Use installed msedge channel.

```powershell
# Terminal1, from cloudflare:
npm run prepare-assets
npx wrangler dev --config wrangler.storage.jsonc --ip 127.0.0.1 --port 8799 --persist-to .wrangler/audio-validation

# Terminal2, repo root:
$env:PLAYWRIGHT_MODULE='C:\Users\em_ps\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs'
$env:VUMIRO_TEST_PCM='C:\Users\em_ps\Documents\ChatGPT\New project 2\Vumiro\dist\audio-validation\native-capture.f32'
node scripts/Test-StreamBrowser.mjs
```

When fixture absent, omit VUMIRO_TEST_PCM to use synthetic calibration PCM (report accordingly). Browser contexts are isolated; no real credentials or local user profiles are used. The account config request is mocked unavailable solely to inspect UI, not to claim hosted authentication.

Local Wrangler was started on port8799 with exec session31348. At pause the session ID was no longer recognized; check listening process before starting another server. Do not stop unrelated user processes. Node browser tests close their contexts/browsers automatically. No hosted async jobs were launched.
