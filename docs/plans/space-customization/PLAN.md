# Curated Space customization

User intent: highly expressive, independently styled Spaces, comparable in depth to community chat themes, with published content restricted to curated marketplace work. Machine Spirit proceeds autonomously under the user's standing instructions; routine approval gates are waived.

## Design

Keep the existing Shadow DOM and theme engine. Integrate committed marketplace branch 53e947d into current Community Hub a9bdc16, preserving both contracts. Separate consumer customization from creator authoring: Space appearance settings use a visual curated collection and app-owned controls; arbitrary imports, CSS and raster uploads remain in the isolated creator workflow, where publication requires review. Existing local creator packages must not appear in the consumer collection.

Provide seven original bundled themes, palette-independent surface/message/corner/spacing presets, typography, layout and accent controls, and a realistic live preview. Each scope retains its own binding; inheritance, undo/redo, discard/reset, narrow preview and personal accessibility remain supported. Changes preview before saving. Unsaved/failed saves never claim persistence.

Marketplace content stays on the marketplace authorization/download path. Do not republish licensed bytes through generic community assets. Live hub licensing is currently blocked by the absent service authority adapter; retain its fail-closed behavior and label local simulation explicitly. This work does not deploy services or change installed profiles.

## Implementation plan

- [x] Integrate marketplace build/route/assets and preserve current Hub safety styles; run focused existing regressions.
- [x] Write failing tests for richer curated builtins and immutable customization presets; implement and pass them.
- [x] Write failing consumer editor tests for no creator imports/CSS/artwork, preset composition, history, persistence and invalid/legacy package handling; implement `VumiroCommunityStudio.createCustomizer(options)`.
- [x] Wire local/shared Space settings to consumer editor, scope preview and content rules; integrate local marketplace targets without copying licensed assets into shared delivery.
- [x] Apply responsive appearance gallery, preview and richer actual Space/home/message styling using existing semantic slots.
- [x] Run focused client/backend checks, independent review and native LOCAL QA; record precise limitations below.

## Review focus

Identity changes during async saves/downloads; unreviewed local package injection; inherited decoration and layout resetting; inaccessible imported artwork; marketplace demo versus live authority; creator cosmetic regression after merge; high contrast and reduced motion winning over theme rules.

## Evidence

Baseline: 66/66 theme/studio/workspace tests pass at a9bdc16. Worktree: `Vumiro-Space-Customization`, branch `codex/space-customization`. Native app worktree tool addressed parent repository and rejected nested-repo ref; explicit git worktree fallback created the correct checkout.

Full native launcher gate passed: 1,040 client tests passed, 2 skipped; all 14 native checks passed, incremental Windows build succeeded, and the isolated LOCAL QA window opened. Reports: `dist/local-qa/checks/checks-report.{md,json}`, `dist/local-qa/launch.json`. Initial focused chat+marketplace+backend gate passed 409 client tests and backend checks. Subsequent review changes have separate focused verification; final focused report is `dist/checks/checks-report.json`.

Independent review findings were fixed with regressions: independent preset ownership, visible explicit colors over gradients, actual message text sizing, shipped/marketplace font selection, effective ancestor layout resets, responsive preview layout, decoration preserving same-scope appearance, and repeat-apply/undo preserving actual composed bindings and later consumer edits. Shared consumers do not hydrate arbitrary legacy packages. Marketplace provenance is local integrity tracking, not a live entitlement grant.

Rulings: routine design approvals waived by user's autonomy instruction. Use original bundled artwork and existing theme engine, with no new dependencies. Consumer detail groups have disjoint property ownership. Complete theme selection resets inherited theme/layout; unthemed homes retain their configured placement. Local decorative compositions are derived only from the existing curated appearance and supplied marketplace pack, validated against total package/asset limits, and stored with deterministic IDs and SHA-256 byte fingerprints. Live licensing/authority integration, production deployment and human acceptance remain outside this completed local appearance pass. No version bump or release.
