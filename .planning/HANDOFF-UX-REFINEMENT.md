# Handoff — account and settings UX refinement

Historical handoff, subsequently resumed by the user on 2026-11-03 with "please conclude the requested changes". Cross-dialog draft retention and final checks are now complete. Current publication evidence is maintained in ACCOUNT-LAUNCH.md; the remaining-work list below records the earlier pause state.

## Workspace and instructions

- Actual repository: `C:\Users\em_ps\Documents\ChatGPT\New project 2\Vumiro`; branch `main`, last published source `b9fbd0a` (prior Google/Microsoft provider setup). Parent cwd is one directory above the repo.
- Go by **Machine Spirit**. User's standing AGENTS instructions authorize autonomous implementation, installation, delegation and publishing without routine approval questions. Developer requires concise commentary at least every 60 seconds. User now explicitly requested handoff/pause.
- PowerShell, unrestricted filesystem/network, approval policy never; do not set `sandbox_permissions`.
- Use CUA for all browser/UI interaction. Do not use Playwright outside CUA, hidden browser state, browser fetch through evaluate, OS automation workarounds, or internal auth-token extraction. Read-only DOM evaluation is allowed.
- Software Factory skill was read and announced; its approval gates are overridden by the user's standing autonomy instruction. No gate documents were created yet. This is a maintenance/refinement pass with implementation already underway.
- Beware huge HTML lines: auth.html embeds a 2.37 MB base64 artwork and fonts; friends.html embeds fonts. Never dump full HTML or huge lines. Use filtered reads, DOM, or sanitized regex summaries.

## Requested scope

User supplied screenshots and requested:
1. Double-click titlebar maximizes/restores window.
2. Full app settings screens rather than small modals.
3. Cleaner account actions, with UX hierarchy rather than a wall of buttons.
4. Signout returns to login.
5. Centered/aligned Vumiro logo and more distinctive typography.
6. Minimal login inspired by screenshot 3; preserve functionality.
7. Returning registered users should not acknowledge privacy every login.
8. Remove standalone Verify email option on login; preserve signup verification flow.
9. After OAuth callback, close the browser tab when possible and bring the app forward.

Reference files in Temp:
- `codex-clipboard-21b2fdb1-76f4-41f5-8e67-aab430216507.png` (button wall)
- `codex-clipboard-65fc0697-b2f2-4a67-a25c-3451ad064cb1.png` (misaligned wordmark)
- `codex-clipboard-62687e85-b397-46cb-91db-357a1dfc2ab1.png` (minimal login/signup visual)

## Implemented, uncommitted

### Account flow — account-client.js and tests/account-client.test.mjs

- Local and all-device signout clear refresh session, then navigate to `auth.html?authView=signin`, preserving invite parameters/hash and local profile/device identity.
- Signin (password/OAuth) no longer requires privacy checkbox. Signup still requires it.
- Reuses ONLY exact current-version backend notice records with valid timestamp. Does not fabricate notice acceptance on signin, transfer pending signup acknowledgement across emails, or accept missing/old/malformed evidence. Missing/changed notice still gates backup/sync in account settings.
- Standalone verification/resume controls removed. `email_not_confirmed` password signin enters OTP flow naturally; signup already automatically enters OTP verification. Pending signup persists without password.
- Healthy login hides registration chatter and Reconnect; failures/unavailable config reveal repair controls. Signup/returning descriptions simplified.
- Root additionally hides Forgot password outside signin, hides redundant Back to signin on signup, and shows signup-only 12-character hint. These last small root additions have not had a full rerun yet.
- Auth Windows titlebar sends drag on every primary pointerdown; DOM dblclick handler removed because native drag consumes DOM double-click sequencing.

### Native desktop — Windows *.cs, Linux main.cjs, related tests

- New `Vumiro.Client/CaptionClickTracker.cs`: Windows OS double-click timing/distance pairing. `WindowChrome.cs` uses it for maximize/restore and resets after real drag/snap. friends-client.js and account-client.js DOM dblclick/detail guard removed to avoid duplicate toggles.
- Valid OAuth code callback restores/focuses Vumiro on both platforms. Invalid callbacks/errors/cancel do not steal focus.
- Callback HTML attempts `window.close()`, scrubs query using `history.replaceState`, retains clean fallback text, and uses hash-authorized CSP. Browser may refuse closing tabs opened by the OS; never promise guaranteed auto-close.
- Windows focus restoration is in `Program.cs`; callback HTML/CSP is in `OAuthLogin.cs`; Electron equivalent in main.cjs.
- Windows checks expanded 18 → 26. New tracker file must be staged for final commit.

### Full app settings — friends.html and appended final IIFE in friends-client.js

- Native dialog semantics retained, but full viewport below/with titlebar; shared left navigation: Your profile, Account, Voice & audio, Screen sharing, Connection, Blocked people, App updates.
- Existing titlebar DOM node moves into the open settings dialog (so modal top-layer doesn't disable native controls), returns to body after close/Escape. Existing handlers preserved.
- Account actions grouped into Profile backup, Password & identity, Linked devices, Sessions, Your data. Short right-aligned action buttons; deletion visually separate. Password form is a disclosure. Existing IDs/handlers/recovery/device controls retained.
- Settings controller originally new settings-layout.js; root **embedded it into existing friends-client.js**, under `/* Full-page settings navigation. */`, and removed standalone file/script reference to preserve updater package compatibility.
- Root fixed topSettings/roomSettings/shareMyCode entry capture handlers so correct section opens.
- Latest worker fixes (after root full suite/build): internal profile-section navigation no longer calls renderProfile and wipes drafts; App updates routes existing updatesNav and requests state; existing updates handler skips rerender when already open.
- Call dock audio now routes to full parent settings ONLY for same-origin exact `/friends.html` parent; unrelated/cross-origin/standalone fall back safely. Changes in call-client.js, tests/audio-settings.test.mjs and tests/sidebar.test.mjs.

### Auth visuals — auth.html

- Existing licensed embedded artwork retained; single left-hand form, removed marketing story/pills/card framing and repeated copy. Social providers below email, compact tabs/footer, local mode/privacy links retained. Password reveal, signup confirmation, OTP, recovery, identity-unlock controls preserved.
- Inlined CSS, no new runtime asset filenames. The temporary auth-layout.css was integrated and removed.
- Logo symbol cropped viewBox to actual ribbon geometry, wordmark/mark aligned. New **Outfit** variable Latin font embedded, offline, sourced from official Google Fonts v15, licensed SIL OFL. Sora retained for existing app body, Outfit headings/brand.
- New `Brand/Outfit-latin.woff2`, `Brand/Outfit-OFL.txt`, updated Brand README and THIRD-PARTY.md. License has been included in existing shipped THIRD-PARTY file; no package manifest additions needed.
- `scripts/Embed-Brand.ps1` now refreshes Outfit in auth/friends as well as existing Sora logic.
- Compact-height rule makes signin fit 1280x720. Mobile/narrow viewport QA remains.

### Release version prepared

Version **1.21.9** set in Windows client/updater csproj and Linux package.json/package-lock.json. No tag/release/deploy yet.

## Critical update compatibility

Old installers enforce an exact file allowlist. **Do not add new runtime filenames to the published v2 ZIP.** Root avoided changes to manifests/ClientUpdateInstaller by embedding settings controller and auth CSS in existing JS/HTML. This preserves frozen 1.21.1 bridge → full v2 transition. New source font files are embedded; legal text ships through existing THIRD-PARTY.md.

## Verification completed

- Root full client regression suite **66/66**, backend **16/16**, before final two settings/audio regressions and small root auth visibility tweaks.
- Account worker latest **31/31** passed before root's small visibility/hint additions.
- Settings worker latest combined sidebar/audio suite **25/25** passed after all three final review fixes (was 23 before adding two regressions).
- Windows callback/caption checks **26/26**, Release build zero warnings/errors.
- `scripts/Build-Client.ps1 -OutputDirectory dist/client-1.21.9-qa` succeeded. `scripts/Test-ClientPackages.ps1 -OutputDirectory dist/client-1.21.9-qa` passed bridge/full-package compatibility.
- Those local ZIPs are now **stale** relative to final settings/audio fixes and root auth changes. Rebuild into a fresh output directory; Build-Client refuses existing output directories. Do not publish stale ZIPs.
- Syntax checks for account-client.js, friends-client.js, main.cjs passed before final worker fixes; worker syntax passed afterward.
- `git diff --check` originally caught trailing whitespace in copied Outfit license; root stripped trailing whitespace/extra EOF blank in THIRD-PARTY.md and Outfit-OFL.txt. Rerun final check; routine LF/CRLF warnings are not failures.

### Browser QA completed with local disposable mock fixture

Local fixture source: ignored `dist/ui-preview.mjs`; serves current real WebServer files, injecting only mock auth/backend + memory/sessionStorage secure-store at `http://127.0.0.1:8873`. Uses `preview@example.invalid`, never real credentials/API mutations. Existing user's installed app/profile untouched. The fixture server was stopped for handoff; restart with `node dist/ui-preview.mjs` in the repo before reloading the tab.

Via CUA tab **17**, browser **2**, variable `uxPreviewTab` (if still available):
- Minimal signin layout fits 1280x720; no privacy acknowledgement or standalone verify entry.
- Mock signin navigated to friends, created local `Preview User` profile through real UI.
- Settings full window; profile/account/audio/sharing/connection/updates all accessible.
- Audio settings opened without microphone capture.
- Escape closed settings, restored titlebar parent BODY, no open settings dialogs.
- Account actions rendered cleanly; signout clicked and returned directly to auth signin, with minimal login intact.
- Signup showed email/password/confirmation, privacy detail/ack and provider options.
- Final worker draft-preservation/call audio routing fixes still need final browser QA; narrow/short viewport/signup/recovery and errors also need final pass.
- Currently tab17 is on signup view of local fixture, last shown URL `http://127.0.0.1:8873/auth.html?authView=signin` (view switched in-place via UI).

## Remaining findings / next steps when resumed

1. **Draft retention across separate dialogs:** worker reports drafts now survive switching sections within profile dialog, but crossing to Account/Audio then returning still calls profileNav/renderProfile and resets uncommitted name/username/avatar/connection/sharing drafts. Prefer a settings-session lifecycle (initialize once per opening, preserve across shared settings navigation) rather than blind field snapshots. Decide/fix this remaining UX issue.
2. Final browser QA: all nav including in-call audio; retaining drafts; Escape/window controls; signup/privacy/hint/recovery; narrow/short viewport; return login after signout with local profile preserved. Save screenshots for proof (none from this new pass saved yet; screenshots were emitted only).
3. Full regression rerun (should now be 68 client + 16 backend if only two new tests; verify actual count), 26 native checks, final syntax/diff checks.
4. Rebuild and validate fresh Windows packages, prep/validate Linux assets. CI builds real Linux packages. Review final diff for accidental feature loss.
5. Write brief design/verification record and release notes. No planning document besides this handoff exists yet.
6. Commit/push changes, deploy Cloudflare client assets via `npm run deploy` from cloudflare. Preserve original Durable Object bindings/internal storage owner. Verify live assets match source and account config still service/registration true, providers [google,azure].
7. Tag/push `client-v1.21.9` after checks, wait GitHub `.github/workflows/client-release.yml` Windows/Linux success and all seven release assets. Update release body with actual changes/limitations. Tag triggers automatic publication.
8. Record release/CI/Worker evidence in `.planning/ACCOUNT-LAUNCH.md`. Do not claim full installed hardware/device acceptance merely from mocks/unit/package checks.

## Live service context (prior turn, unchanged here)

- Google/Microsoft production sign-in are already enabled and real callback/PKCE/identity/refresh/logout checks passed in prior turn. `scripts/Test-OAuthProvider.mjs` committed at b9fbd0a.
- Google brand and Microsoft publisher remain unverified; work/school consent may require tenant admin. Supabase project `rrrflwevxojheaejbcnp`, region São Paulo. Both credentials stored only in Supabase; do not extract/log secrets.
- Canonical public Worker `https://vumiro-rooms.vumiro-signaling.workers.dev`, Cloudflare account `1dbbb1cb29ff0607769f984edeaaa3cf` (consult existing runbook if uncertain; exact older summary had `1dbbb1cb29ff0607769f984edeaaa3cf`). Wrangler already logged in; don't print token file.
- Previous app release 1.21.8: source0826933, https://github.com/snoopeh/Vumiro/releases/tag/client-v1.21.8. User installed app was previously1.21.6; don't overwrite user identity/app process without preserving state.
- Prior code Worker version ecf57d68-409b-492b-8321-764a83a512b8/internal6cbc8f79-ee73-40fb-a895-5791abcb0364; provider flags changed later.
- Microsoft app secret expires2027-05-02, rotate-by2027-04-02 documented, not automatically scheduled.

## Agents and tools

Completed worker agents from this pass: `/root/account_flow`, `/root/desktop_return`, `/root/settings_layout`. They share all files. No separate branches/commits. Reuse via followup_task if useful and user resumes; send_message doesn't wake completed agents.

Before continuing browser work after compaction, call `await cua.rewriteDocumentation()`. Reuse browser2; inventory tab state without printing OAuth code URLs. Only use documented APIs. Current native UI may be unavailable; don't claim actual OS focus/doubleclick hardware QA unless exercised.

Ignored helper scripts `dist/redesign-auth.mjs` and `dist/integrate-layout.mjs` are **one-shot, already applied**. Do not rerun: they expect pre-integration markup/source files and would duplicate license/controller or fail. Final sources are actual tracked HTML/JS.
