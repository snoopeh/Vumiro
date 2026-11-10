# Four-stream mosaic design

Date: 2026-11-09  
Source: priority 1C, “Arrange active streams as a mosaic”  
Status: source implemented and isolated LOCAL QA open; human acceptance pending

## Current behavior and goal

The room always expands one focused participant and puts every other participant in a short strip, even when several people share screens. Show every active screen in a balanced mosaic. Support one to four simultaneous streams well, and keep five to eight usable. A participant who is only in voice remains in a separate compact strip and does not take a video cell.

## Options considered

1. **Fixed CSS presets:** one column for one stream, two for two to four. Simple, but wastes space for portrait screens and narrow windows.
2. **Responsive measured grid (chosen):** score column counts by visible video area from each stream's aspect ratio and the available scene box. Favor side-by-side placement for a pair when the room is wide enough. Use CSS Grid for placement and `object-fit: contain` for uncropped video. Keep a compact voice-only strip below it. This adapts to window size and late video dimensions without a library.
3. **Fully freeform masonry:** size every tile independently. It can fill gaps but creates unstable positions and makes controls harder to follow during joins and resizes.

## Behavior

- One through eight sharing tiles stay visible and in stable participant order. One tile fills the scene; two through four choose the best grid of one to four columns for their measured ratios. Five through eight use the same bounded planner and may scroll vertically on small windows.
- The planner scores each candidate by the total visible video area within its cells. Candidate dimensions are bounded; a missing or invalid intrinsic video size uses 16:9 until the video's `resize` event provides real dimensions. Ties favor fewer columns to avoid thin tiles.
- The scene uses a viewport-height budget and a minimum cell height. Small windows reflow to one column; the page scrolls vertically instead of clipping streams. Voice-only participants remain in a compact grid below the videos.
- Click or keyboard Select changes which stream's Fit, Actual size, Fullscreen and audio controls are shown. It does not enlarge or reorder a tile. Double-click still opens a stream in fullscreen. The separate People panel remains available.
- Existing direct media transport, track selection, capture permissions, mute state and call sound are unchanged. Layout state is local and is not sent to peers.

## Implementation boundary

`call.html` owns two containers inside `#tiles`: the screen grid and the compact participant strip. The pure geometry planner and DOM updater are at the start of the existing `call-client.js` asset, followed by room state and tile handling. The updater moves existing tile elements between containers when their sharing state changes; it does not recreate players or tracks. A `ResizeObserver` watches scene width, window resize updates the height budget, and each video's existing resize handler re-plans after intrinsic size changes. Observer work is limited to layout and is detached when the page closes. Keeping this code in the existing asset preserves the fixed Windows updater file lists, including the legacy bridge package.

## Acceptance and verification

- One to four sharing tiles are all visible, uncropped, and use more of the scene than the old focus-plus-thumbnail layout. Two wide streams fit side by side in a wide room; a narrow room stacks them. Three and four receive balanced cells; portrait and late-metadata sources re-plan.
- Voice-only participants stay accessible outside the video cells. Joining, leaving and stopping share update the mosaic without losing video playback, selection, fullscreen or audio controls.
- At mobile-sized widths the page has no horizontal overflow from the tiles, and a user can reach every stream with vertical scroll and keyboard focus.
- Unit tests cover planner choices, aspect ratios, invalid dimensions, ordering/DOM moves and stream-count transitions. Client syntax and focused room tests pass. Human QA must inspect one to four live streams at wide and narrow sizes, and a room with more than four streams.

### Verification record

- Feature commits: design `37a970f`, plan `f645c9b`, implementation `d7f9229`, update-package compatibility `4e204d6`.
- The isolated `4e204d6` implementation passed release-version checks, JavaScript syntax and 284/284 client tests. Both Windows package variants built with zero warnings/errors, and `Test-ClientPackages.ps1` validated the legacy-to-complete transition. The clean worktree then passed the LOCAL QA launcher's 284 client tests, OAuth/native invariants, local-service isolation, updater checks, native-audio recovery, diagnostics, and a Windows Debug build with zero warnings and errors.
- The running review window is `Vumiro · LOCAL QA · 4e204d6` from `Vumiro-Mosaic-QA`, with its separate QA profile. The main checkout contains simultaneous, uncommitted cover-media work and was not used for this review window. Its aggregate client run had three failures in that unfinished cover work at the time of verification; this record does not claim the aggregate checkout is ready.
- One-to-four and narrow geometry are automated. Live multi-client video, audio-control focus after reparenting, more than four streams, and Linux/device visuals still require human QA. No human acceptance has been recorded.

## References

- [MDN CSS `object-fit`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/object-fit): `contain` preserves all video content inside a cell.
- [MDN CSS Grid](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout): equal grid tracks provide stable regions.
- [MDN `HTMLVideoElement` resize](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/resize_event): re-plan when intrinsic dimensions change.
- [MDN Resize Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Resize_Observer_API): react to scene width changes.
- [W3C WCAG reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html): keep content reachable by vertical scrolling at narrow widths.

## Release boundary

This design addresses the mosaic item only. Existing uncommitted native audio code currently mixes eligible processes without binding audio to the chosen video application. It must be corrected or disabled before aggregated changes can be signed off for release. No service deployment or release is part of this task.
