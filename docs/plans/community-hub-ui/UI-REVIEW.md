# Community Hub — UI Review

**Audited:** 2026-11-11
**Source baseline:** `codex/community-hub`, commit `b64bf1c`; findings reference that revision, before the redesign.
**Baseline:** `docs/plans/community-hub/PLAN.md`, six-pillar standards, and the user's requested Discord-like behavior: bottom composer, inline voice, strong Space boundaries, inline creation/editing, and clear navigation/state. No UI-SPEC.md was found in the scoped planning paths.
**Screenshots:** Not captured. This is a source-only audit, explicitly requested by the orchestrator. HTTP probes on localhost ports 3000, 5173, and 8080 all returned `000`. No GUI, native interaction, visual measurement, device/audio check, or broad test suite was run. Screenshot storage exclusions were established at `.planning/ui-reviews/.gitignore`.
**Assessment limit:** CSS and render paths establish the defects below; actual pixel appearance, contrast under arbitrary creator themes, and native behavior require later human QA. Prior Windows QA recorded in PROGRESS.md is historical evidence, not verification performed by this audit.

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| Copywriting | 2/4 | Mixed scope terminology and technical workflows obscure the next action. |
| Visuals | 1/4 | Spaces have the same row treatment as folders/channels; administration competes with conversation. |
| Color | 2/4 | The theme engine forces accent fill on primary and secondary buttons alike. |
| Typography | 3/4 | Hierarchy exists, but small fixed text and inconsistent heading roles reduce clarity. |
| Spacing | 1/4 | Messages and composer share one scrolling document; narrow layout stacks the tree above chat. |
| Experience Design | 1/4 | Voice controls disappear on navigation; channel management requires destination screens. |

**Overall: 10/24.** Scores are independent. The presence of functional components does not satisfy the rejected interaction design.

## Top 3 Priority Fixes

1. **Build a persistent conversation frame.** Make the channel header and composer fixed grid/flex regions, with only the history scrolling. Preserve channel drafts and scroll position. **Acceptance:** at 1440×900, 768×1024, and 375×812, with zero and 200 messages, composer/send remain reachable without scrolling the history; incoming messages do not move a reader away from older messages; switching channels restores the draft.
2. **Move voice into navigation and a persistent connection dock.** Join from the voice row; list participants beneath it; keep connected channel, mute state, and disconnect visible while reading any text channel or home. **Acceptance:** joining voice does not replace the selected text channel; join, mute, unmute, and leave work from the persistent controls; active channel and participants remain visible after navigation and rerender. Label simulated participants separately.
3. **Give Spaces distinct navigation boundaries and contextual controls.** Use a strong Space header/group, scoped channel tree, unambiguous current Space/channel, plus inline add/edit controls. Put advanced settings behind scoped actions. **Acceptance:** users can distinguish hub, folder, Space, and channel without relying only on color; add a child and rename a channel directly from its row/group; keyboard users reach the same actions; settings identify the affected scope before saving.

## Detailed Findings

References below are relative to `Vumiro.Client/WebServer/` at the audited revision.

### Pillar 1: Copywriting (2/4)

- **WARNING C1 — Scope vocabulary changes within the same flow.** `community-workspace.js:38,111–113` uses Community Hub, Guild home, community, and Hub; `:44,105` labels structural actions “Create item” / “Create shared item.” These names hide whether the action creates a channel or an independently managed Space. Use consistent Hub → Space → channel naming and contextual labels such as “Create channel in Valheim.” **Acceptance:** navigation and dialogs name the scope and object type; no generic “item” creation/save action remains in the primary journey.
- **WARNING C2 — Access flows expose identifiers and implementation output.** `community-workspace.js:52` renders effective access as raw JSON; `:84,112` asks users for a Space identifier, Community ID, and invitation token in separate fields. Keep technical details in an optional disclosure, accept a single invitation link/code, and show readable permission outcomes. **Acceptance:** an invited member can open the destination without extracting an ID; permission preview states “Can read,” “Can post,” and the relevant inherited restriction.
- **WARNING C3 — Shared appearance saves claim local-only completion.** `community-studio.js:97` always reports “Appearance saved locally,” including the shared save callback wired by `community-workspace.js:111`. Supply save-context copy from the caller. **Acceptance:** a shared save names the shared scope; local drafts and installed packages retain explicitly local wording.

### Pillar 2: Visuals (1/4)

- **BLOCKER V1 — Spaces lack a distinct visual and interaction boundary.** `community-workspace.js:35,86` renders every hierarchy type as `.ch-row` with the same button treatment and depth×12px indentation; Space identity is essentially a diamond glyph. `:30,111,113` applies the selected theme to content, leaving navigation without corresponding active-Space treatment. Group Space identity, scoped actions, and descendants visibly; retain neutral application navigation with a clear current-Space marker. **Acceptance:** sibling Spaces remain distinguishable when expanded, when collapsed, and in simplified styling; current Space is explicit on every channel view. This is visual/interaction segregation, not a claim that authorization is broken.
- **WARNING V2 — Everyday conversation competes with administration.** `community-workspace.js:111,113` places Home/Channel, Manage, Theme Studio, and local access/connection controls above the content; `:6` gives tabs and breadcrumbs substantial vertical separation. Move advanced operations into scoped menus/settings and establish one channel header. **Acceptance:** the channel header identifies Space and channel; normal conversation does not require a row of administration tabs; owners can still reach settings in one contextual action.

### Pillar 3: Color (2/4)

- **WARNING K1 — Accent has no primary-action budget.** `community-themes.js:185–187` gives every marked `button` accent background and accent text, then emits `!important` declarations through `:180`. `community-workspace.js:17` marks ordinary navigation/action buttons with this slot, while `:22` leaves form submit buttons without it. Thus breadcrumbs, secondary actions, and destructive controls can receive stronger treatment than submit actions. Define semantic primary, secondary, navigation, and danger variants and theme all through the same explicit variant contract. **Acceptance:** only the main action and limited active/focus indicators use accent emphasis; destructive actions use danger semantics; breadcrumb and routine secondary controls remain subdued in all three shipped themes. The 60/30/10 distribution was not visually measured.
- **WARNING K2 — Active state can be overridden by theme rules.** `community-workspace.js:6` styles current navigation via `button[aria-current=page]`, while `community-themes.js:185–187` forces button text and border colors. Supply app-owned selected background/indicator rules that survive theme application. **Acceptance:** selected channel/tab remains recognizable in baseline, Viking, Cyberpunk, high-contrast, and simplified styling, using more than a text-color change.

### Pillar 4: Typography (3/4)

- **WARNING T1 — Small fixed labels and heading roles need refinement.** `community-workspace.js:6` specifies 11px top metadata/status/badges, 12px secondary text, 14px body, 17px h3, 18px h1, and 26–42px h2: six size treatments with predominantly normal/bold browser weights. Large h2 is used for both homes and channel names (`:38,40,87`). Keep large display typography for homes and use a compact channel-title role; make important status readable at a minimum 12px and respect user scaling. **Acceptance:** channel headers have consistent compact typography, critical connection/save state is readable at supported scale settings, and long names wrap without crowding controls. Typography otherwise has a real heading/body hierarchy; this is a minor-quality score, not a missing-system claim.

### Pillar 5: Spacing (1/4)

- **BLOCKER S1 — Composer is part of the history document.** `.ch-content{overflow:auto}` in `community-workspace.js:6` contains headings, message list, and form appended sequentially in `:40–41,87–88`. There is no dedicated flexible history region or anchored composer. Shared “Load earlier messages” is also appended below history, just before the form. Introduce header / scrollable history / composer regions; put earlier-history loading at the history start. **Acceptance:** apply priority fix 1's viewport/message matrix; composer stays visible with long messages and expanded input; loading earlier messages preserves the visible message anchor.
- **WARNING S2 — Narrow layout converts navigation into top-of-chat content.** `community-workspace.js:7` stacks the sidebar above content at ≤480px, caps it at 260px, and changes content overflow to visible. At ≤720px, a 185px sidebar remains alongside content. Use a deliberate navigation drawer/back affordance with a full-width conversation instead of shrinking or stacking the desktop layout. **Acceptance:** at 375px, channel switching is reachable, the current Space/channel remains named, and composer/send fit without horizontal scrolling or scrolling past the tree.
- **WARNING S3 — Density token controls only fragments of spacing.** `community-workspace.js:6` mixes 3/4/5/7/8/9/10/12/14/16/18/20/22/24/30/35/40/48px declarations. The spacing token affects tabs/actions and content padding, while cards/messages have isolated compact overrides. Define a small shared scale and compact control/header/card metrics. **Acceptance:** switching density predictably changes channel rows, controls, messages, and cards; essential target sizes and the anchored frame remain intact.

### Pillar 6: Experience Design (1/4)

- **BLOCKER E1 — Voice is a destination screen with disappearing controls.** `community-workspace.js:86` selects a voice node as the content destination; `:87` alone renders join/mute/leave/state/participants. `:72` updates participant DOM only if that destination exists, and rerender creates an empty participant container rather than painting a retained participant snapshot. Separate connected voice state from content selection and render the dock/tree from retained state. **Acceptance:** apply priority fix 2's navigation matrix, including switching away/back and receiving participant updates while another channel is open. No real SFU behavior is claimed verified here.
- **BLOCKER E2 — Add/edit is unavailable in the tree.** `community-workspace.js:35,86` offers only expansion/selection; `:43–45,105` requires Manage forms for creation, rename, reparent, and archive. Add contextual controls with accessible names and a focused inline editor/dialog. **Acceptance:** create text/voice channels under the intended Space and rename a channel without opening a management destination; Enter saves, Escape cancels, focus returns to the invoking control, and unauthorized actions are unavailable.
- **WARNING E3 — Live navigation and messages omit important state.** `community-workspace.js:86` does not render unread counts or voice participants, unlike local unread output at `:35`; shared tabs at `:111` do not mark the current page. `:81` replaces message children and the log at `:88` has an accessible label but no live announcement policy or scroll-anchor handling. Render selected page, unread badges, retained participant state, and a bounded new-message announcement/scroll policy. **Acceptance:** off-channel messages update unread without stealing focus; the current destination is explicit; an older-history reader sees a new-message indicator and can jump to latest; screen readers receive concise updates without rereading the entire log.
- **WARNING E4 — Pending/error/destructive states are inconsistent.** `community-workspace.js:19,21` runs asynchronous forms without a general busy/disabled policy; `:45,103,105` archives/removes immediately without confirmation or an adjacent undo path. Shared send at `:88` disables its textarea, while Studio at `community-studio.js:78` has stronger save disabling. Reuse an operation-state pattern, contextual recovery, and confirmation or reversible undo for destructive actions. **Acceptance:** double activation cannot duplicate a mutation; pending operations name their action; failures retain edits and offer a relevant retry; archive/remove clearly identifies its target and allows cancellation or restoration.

## State Coverage and Strengths

Loading text, alert nodes, local save feedback, retained per-channel drafts, shared retry identifiers, theme undo/redo, reduced-motion handling, visible-focus CSS, tree keyboard navigation, and explicit local/demo labels exist. They are useful foundations. They do not resolve the structural findings. The audit did not prove runtime accessibility, actual contrast, native rendering, or device behavior.

Registry safety audit: not applicable; no root `components.json` was present and no third-party registry contract was found in the scoped input.

## Files Audited

- `AGENTS.md`
- `docs/FEATURE-MAP.md`
- `docs/CONTEXT-WORKFLOW.md`
- `docs/plans/community-hub/PLAN.md`
- `docs/plans/community-hub/PROGRESS.md`
- `Vumiro.Client/WebServer/community-workspace.js`
- `Vumiro.Client/WebServer/community-themes.js` — relevant tokens, validation, showcase, resolution, application code
- `Vumiro.Client/WebServer/community-studio.js` — relevant control, save, preview, and state code

**Recommendation count:** 3 prioritized redesign workstreams; 15 classified findings (4 blockers, 11 warnings). The priority workstreams combine related findings rather than replace the remaining recommendations.
