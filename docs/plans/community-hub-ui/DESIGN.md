# Community Hub conversation-first redesign

User direction: Discord-like behavior, stronger Space segregation, fixed composer, inline voice, discoverable channel creation/editing. Machine Spirit owns design choices under standing autonomous instructions; no additional approval gates.

## Critique and approach
The first implementation exposed storage/configuration concepts as an administrative dashboard. It passed functional checks but failed the everyday reading, chatting and joining flow. A cosmetic recolor would preserve that failure. Replacing the entire app with a Discord clone would expand scope unnecessarily. Rebuild the Community shell around persistent communication regions, preserving the existing model, transport, permissions and portable themes.

## Screen and behavior
- Compact existing app navigation to a 72px rail while Community is active. Keep accessible names. Hide the redundant outer Community heading/footer.
- A 264px channel sidebar contains the hub switcher/header, local/live status, search, overview, strongly grouped Spaces, channels and contextual actions. Folder labels are subdued; Space headers include a distinct identity tile, name and divider. Selected channel has an app-owned background/indicator, beyond color alone.
- Main pane has one compact channel header naming Space/channel, description and scoped settings. No permanent administration tabs in the conversation. Settings opens a focused overlay with Overview, Structure, Access, Appearance and Connections navigation, and a close/back action. Advanced forms remain accessible there.
- Chat uses header / independently scrolling message history / bottom composer. Enter sends; Shift+Enter inserts newline; IME composition never sends. Draft survives navigation. Preserve a reader's scroll position; pin only when already near bottom, with a new-message button otherwise. Earlier-history loading remains at top and keeps its visible anchor.
- Voice row joins without replacing the current text/home. Participants are nested underneath. Persistent bottom sidebar dock names the voice channel, truthful connection/mute state, mute/unmute and disconnect. State survives rerenders/navigation; leaving Community stops media. Local demo voice is explicitly simulated and never captures the microphone.
- Inline plus opens a small create dialog in the chosen container, with object type/name and a clear location. Row gear opens scoped settings, including rename/move/archive and appearance/access. Dialog is keyboard accessible, has Escape/close, returns focus, and never silently acts on a different scope.
- Hub/Space homes use a readable welcome, destination cards and restrained activity. Themed rooms use neutral application chrome, compact controls and limited accent emphasis. Appearance changes never affect control geometry or behavior.
- Narrow layout uses a deliberate channel drawer and full-width conversation, rather than stacking a large tree above history. Composer and voice dock remain reachable. All icon controls have accessible names, visible focus and touch targets.

## Design system
Use a charcoal neutral shell, off-white text, muted secondary copy, thin dividers and a single active/action accent. 4/8px spacing scale; 32-36px rows, 48-56px header, body 14px and readable 12px metadata. Buttons have explicit primary/secondary/quiet/danger semantics. Custom package slot CSS remains validated; app-owned action and selected-state rules apply after package decoration. Original Viking and Cyberpunk themes remain distinct in content, with restrained frames and no dashboard-card overload.

## Implementation boundaries
Keep tree/model, migration, live authorization, identity isolation, theme validator and SFU implementation. Change only presentation/controllers, Studio presentation, button application contract and static asset integration. No production service changes, deployment, release or version bump. Work in the existing isolated branch and preserve concurrent edits.

## Acceptance
See UI-REVIEW.md. Automated interaction tests cover anchored region structure, Enter/Shift+Enter/IME, draft persistence, independent voice selection/dock/participants, contextual creation/editing, scoped settings, mobile drawer, unread scroll behavior and identity cleanup. Test all existing community regressions. Verify desktop and narrow behavior in real Windows LOCAL QA; Linux compatibility checks run in the full gate. Hardware/SFU and capacity acceptance remains outstanding.
