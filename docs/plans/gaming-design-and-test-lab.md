# Gaming design and private test lab

## User outcome

Use a properly licensed, recognizable controller asset with accessible remapping hotspots. Improve controls across the app with consistent flat surfaces, restrained icons, clear focus states and appropriate switches/radios/sliders. Gaming should present concise settings rows with room to breathe. Test without publishing a release or touching the installed profile.

## Design decisions

Keep the dark/red Vumiro identity. Restore flat button fills without gradients, bevels or elevation; use equal-RGB neutral grays throughout shared surfaces while retaining deliberate accent colors. Preserve the latest editorial support/donation page from the shared checkout. Use a common control stylesheet/icon helper across Friends, Calls and account entry. Preserve native input semantics and settings persistence; binary preferences become switches while consent/selection checkboxes remain checkboxes. Gaming uses a reusable view module, source controller art, segmented input choices, a bitrate slider and advanced details rather than long instruction blocks.

## Boundaries

The existing session engine and signed admission protocol remain the game transport. A separate test-lab module creates isolated ephemeral identities/RTC peers and synthetic media, never modifies real contacts or silently starts privileged setup. Manual capture uses the real picker. Explicit LOCAL QA-only native tests check temporary adapter I/O/cleanup and virtual Xbox input through XInput. Busy sessions refuse destructive diagnostics.

A portable private QA kit contains current app/web sources and a matching private signaling relay, launchers for separate identities and a host/guest guide. Private LAN signaling relaxations apply only in LOCAL QA. Production connection policy remains unchanged.

## Slices and verification

1. Licensed controller asset, accessible 24-control diagram and provenance tests.
2. Shared app controls with semantic interaction tests and native visual review.
3. Gaming settings layout, live keyboard/gamepad monitor, preserved bindings/focus behavior.
4. Browser loopback/capture diagnostics with cancellation and truthful unavailable/failure results.
5. Native adapter/XInput checks and private two-PC QA kit.
6. Focused checks, real WebView review at desktop/compact sizes, independent review and narrow merge into original checkout.

Work occurs in the isolated Vumiro-Design-QA checkout. Snapshot baseline is 53a2008; original uncommitted work remains untouched until a guarded three-way merge. The user explicitly authorized autonomous decisions and no permission pauses; generic skill approval gates are waived by those instructions. No version bump, public release or production deployment is authorized.

## Verification handoff

Full client/backend and thirteen native check groups passed in the isolated checkout. The actual LOCAL QA WebView decoded local video/audio and passed all nine transport checks; mapping rebinding, physical-mode bypass and compact layout were exercised. A real temporary Xbox device passed exact XInput report, neutralization and removal checks. Independent review caught and corrected stale submenu selection, a live-video placeholder overlay, pending native-start exclusion and an overly short native diagnostic deadline. Duplicate-label/icon behavior is checked across repeated locale changes and dynamic rerenders. Final combined-checkout receipts and private kit are generated under dist after the guarded merge. Real two-PC gameplay/capture, Windows adapter authorization and Steam/game compatibility remain explicit human QA steps.
