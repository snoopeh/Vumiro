# Profile customization implementation plan

Machine Spirit owns `codex/profile-customization` in `Vumiro-Profile-Customization`, based on marketplace commit `53e947d`. Sibling worktrees and branches remain untouched. The desktop chat is attached to the outer workspace repository, so Git created this worktree in the actual nested Vumiro repository.

The user requested autonomous implementation and separate spaces for concurrent agents. Design decisions below are made under that authorization; no additional approval gates are introduced.

## Design

Extend the existing personal cosmetic packages, renderer and marketplace rather than creating another entitlement system. Add three original animated GIF collections, each with an avatar and user-card frame: Astral Tide (blue/violet orbit), Sakura Glass (rose/gold drifting light), and Ember Forge (amber/red sparks). GIF bytes are embedded in portable packages, with static borders when motion is disabled. No remote image loads.

A Profile styles dialog opens from the profile editor, previews the current user's real portrait/name/bio, and offers independent avatar/card selections, motion controls and reset. It clearly labels try-on as a preview and opens the existing marketplace flow for acquire/install/equip. Preview never changes signed identity, ownership, account appearance or the existing editor draft. Existing marketplace local simulation and remote service semantics remain intact.

## Files and boundaries

- `profile-style-samples.js`: original generated GIF packages; portable/shared validation.
- `profile-style-studio.js`: accessible local try-on dialog and preview lifecycle.
- `marketplace-model.js`, `marketplace-client.js`, `marketplace-entry.js`: list samples and open the selected listing through the existing marketplace.
- `friends.html`: module load order and profile customization entry.
- Desktop/Linux/Worker asset lists and bundle map: deliver both modules through every existing host.
- Focused Node tests: actual GIF structure/animation, package validation and reduced-motion cleanup; dialog interactions, close/reset, marketplace navigation, account/identity changes and integration.

## Slices

- [x] Establish focused baseline checks (195/195).
- [x] Add failing sample/portable package tests; generate and wire real animated GIF collections; pass tests.
- [x] Add failing dialog interaction tests; implement profile try-on dialog; pass tests.
- [x] Wire editor entry, marketplace deep linking, asset manifests and focused checks.
- [x] Run fresh full checks, inspect actual LOCAL QA startup and document limits.
- [x] Keep reviewed source on the isolated branch for later coordinated integration.

## Verification and handoff — November 11, 2026

- `./scripts/Run-Local.ps1`: full uncached client/native suite passed, 925 client tests passed and two optional tests skipped; all fourteen native projects passed. Windows Debug build: zero warnings and errors. Receipt: `dist/local-qa/checks/checks-report.json`, fingerprint `2b40f9faddfef44f24079a4699c6e819b6cd22b4673821803123e864266e3a04` (before this documentation-only completion update).
- `npm test` in `cloudflare`: 178/178 passed. Log: `dist/profile-backend-tests.log`. The initial broader runs caught the static label translation and Worker asset allowlist; both were corrected and their relevant suites rerun successfully.
- An isolated native WebView2 fixture under `dist/profile-style-runtime` passed forty-five executable checks. All six GIFs decoded natively; real CSS masks and artwork sizing, independent slots, pause/resume and OS reduced motion, URL cleanup, reset, reopen races, marketplace entry/client handoff, draft retention and 1260px/390px overflow were verified. The actual settings-draft confirmation and extracted workspace navigation functions also passed: Keep editing preserves the draft and preview, failed Save blocks navigation, and Discard allows the selected marketplace listing to open. Report: `dist/profile-style-native-report.json`; screenshots: `dist/profile-style-native-studio.png`, `dist/profile-style-native-narrow.png`, `dist/profile-style-native-collections.png`. Fixtures use temporary browser data and no production accounts or backend calls.
- Independent read-only code review found no actionable findings. New behavior was tested RED then GREEN.
- LOCAL QA process 68100 launched from this checkout; window title verified as `Vumiro · LOCAL QA · 53e947d + working tree`. Launch/profile paths are in `dist/local-qa/launch.json`. The isolated profile opens independently of other agents' apps.

### Integration boundary

This branch depends on the existing `codex/marketplace` commit `53e947d`; its base is intentionally distinct from the ongoing Community Hub and Space customization branches. Integrate the marketplace groundwork first, then this feature commit, preserving concurrent Community Hub module and asset-list additions. No sibling checkout was changed or merged. The feature's shared-file changes are limited to entry markup/load order, translated button text, sample catalog/deep-link APIs, renderer raster sizing and asset manifests.

### Usage and remaining acceptance

Open Your profile → Profile styles. The new three matched collections appear first; original avatar/card presets remain available. Mix avatar/card choices, pause animation, reset the try-on, export a selected `.vumirotheme`, or use the existing marketplace acquisition flow. Regenerate all original artwork and portable samples with `python scripts/Generate-ProfileStyleSamples.py` (Pillow is a development-only dependency); exports and an animated sample board are in `dist/profile-samples`.

The dialog follows the existing English marketplace UI; the static entry button supports all six existing languages. User names, biographies and package titles are opaque to automatic translation. New samples are free in local simulation and must be uploaded/reviewed before appearing in a connected service; missing live sample IDs open the appropriate category with explicit feedback. Live equipment continues to require the existing enabled marketplace service. Human acceptance and Linux runtime QA remain pending.

## Limits

No production deployment, release version change, payment activation, automatic merge into another agent's branch or alteration of production profile data. The existing service enablement and moderation/entitlement requirements govern live equipment. Human visual acceptance remains separate from automated checks.
