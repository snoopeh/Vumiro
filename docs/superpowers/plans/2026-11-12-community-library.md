# Community library implementation plan

**Goal:** Community Hub opens a personal community library before entering any hub.

**Design:** Use an Xbox-inspired responsive artwork grid. Each card has independent cover art and a small server icon, its name, a compact friends strip, and a hub-specific frame revealed by hover or keyboard focus. Show friend locations through an accessible details control; make all interactions work on touch. Owners can change the cover, icon, frame preset, color, and transparent frame artwork in hub settings. Use deterministic decorative fallbacks for hubs without pictures. Respect reduced motion and simplified styling.

**Alternatives considered:** A compact icon rail hides too much identity and presence; hover-only friend counts are harder to discover on touch. Prefer cards with visible counts and expandable details.

**Architecture:** Extend the existing v2 local hub schema with optional normalized card metadata. Store only remembered shared hub identifiers and public artwork/name metadata per identity and service. Refresh with authorized, temporary snapshot requests; never retain invitation tokens or pretend cached presence is live. Expose authenticated hub presence from the service, filtering private channel locations. Intersect this presence with the saved friend directory. Local sample members stay labeled as simulated.

**Authorization:** User requests autonomous execution without permission gates. Apply design decisions directly within the requested feature; no publishing or release.

## Port to 1.22.5

The user subsequently requested committing/pushing these changes and updating the project. Source handoff targets `origin/main` and `origin/codex/community-hub`, with the clean primary and integration checkouts synchronized to the feature commit. Keep the version at 1.22.5; source publication is separate from an application release or service deployment.

The user requested moving this feature onto current code after identifying the stale 1.22.3 baseline. `codex/community-hub` was fast-forwarded to `cd70ad28e72648bfa62c4cdd0f05df3f2ae5b895` (Vumiro 1.22.5, 33 newer commits). The original full working changes remain recoverable at `refs/codex-backups/community-library-before-1.22.5`, SHA `79842212824e039a82f9f9a883c79b9a075ef94e`, and its named stash. Do not restore entire older files over this baseline.

Conflicts preserved the updated context menus, permission guards, Marketplace/session fences, private appearances and reviewed shared-theme sanitization. Card metadata and authenticated presence were layered onto those implementations. `friends.html` now exactly matches 1.22.5, which already preserves the sidebar across destinations. The library's images are dedicated owner-controlled branding fields, not a path for installing or authorizing theme packages; see `docs/COMMUNITY-HUB.md`.

Fresh verification on 1.22.5: focused chat/Marketplace/friends checks 696/696 plus backend passed; full launcher client suite 1,234 passed, 4 skipped, zero failed; all fourteen native checks and native build/startup passed. Receipts: `dist/checks/checks-report.json` and `dist/local-qa/checks/checks-report.json`. The running managed executable's assembly version was verified as `1.22.5.0`, with window `Vumiro · LOCAL QA · cd70ad2 + working tree`, source `Vumiro-CommunityHub`, PID 56500 at launch. Native runtime verified library entry, the updated hub menu, and 244px sidebar in Friends/library/hub with profile details visible. Screenshot: `dist/local-qa/community-library-1.22.5.png`. No push or release was performed.

The verification notes below describe the original pre-port implementation; use the 1.22.5 results above for the current handoff.

**Sidebar requirement (user correction):** Keep the shared main sidebar expanded when selecting Community Hub, the library, or a community. Do not substitute a hub-specific icon rail or hide destination labels, branding, profile information, or expanded submenus. The shared responsive layout owns sidebar sizing. Removed the old hub-only 72px/56px rail CSS; native QA measured the same 244px sidebar in Friends, library, and hub with labels/wordmark/profile visible. Existing navigation/sidebar checks: 17/17 passed.

- [x] Add failing metadata/presence, catalog, and library navigation regressions.
- [x] Implement backward-compatible metadata validation and authorized presence snapshots.
- [x] Implement per-profile/service shared community catalog without secrets.
- [x] Implement library entry, search, create/join, return navigation, friend details, and artwork editing.
- [x] Add responsive card/frame styles and friend-directory wiring.
- [x] Run focused chat/backend checks, then LOCAL QA checks and launch the native app.

**Ownership:** Main agent owns workspace/UI/friends wiring and workspace tests. Artwork worker owns community-model and community-hub service plus their tests. Catalog worker owns community-live and its tests. Preserve concurrent edits.

## Verification and handoff

- `node scripts/Check-Client.mjs --group chat`: fresh 286/286 client checks, versions, syntax and backend passed. Receipt: `dist/checks/checks-report.json`.
- `./scripts/Run-Local.ps1`: full client suite and thirteen native checks passed; native build/startup verified. Receipt: `dist/local-qa/checks/checks-report.json`. Subsequent UI hover polish was verified by fresh focused checks and native runtime inspection.
- `node --test tests/sidebar.test.mjs`: updated identity teardown regression enters through the library; all 15 passed.
- Independent review found failed transport recovery and catalog quota persistence issues; both corrected with failing-then-passing regressions. Review has no outstanding important findings.
- Actual LOCAL QA WebView2: default entry shows library; five temporary simulated sample cards verified artwork, icons, frames and friends. Focused friend details opened, popover visible, frame opacity 1. Narrow 390px viewport had no horizontal overflow. QA fixture screenshot: `dist/local-qa/community-library-qa-fixture.png`; narrow screenshot: `dist/local-qa/community-library-qa-mobile.png`; focus screenshot: `dist/local-qa/community-library-qa-hover.png`.
- Temporary native fixtures and viewport overrides removed; normal QA profile left on community library. No user communities, messages, invitation tokens or production credentials modified by visual checks.
- Source readiness: implemented and ready for human QA. No release/deployment. Live friend presence requires shipping the updated community service; older services show presence unavailable. Previously joined shared hubs need one reconnection to populate their new device-local catalog. Uploaded images accept raster files under 145 KB or HTTPS image URLs.
