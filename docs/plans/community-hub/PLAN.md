# Community Hub: Nested Communities and Theme Creation

## Summary

Replace the user-facing **Servers** feature with **Community Hub**: a clean, expandable tree containing folders, independently managed Spaces, and Discord-style text and voice channels.

Build in stages: establish the workspace and theme creator locally, then add shared communities and live communication. Marketplace development remains a separate plan, connected through the portable theme contract defined here.

## 1. Workspace and hierarchy

```text
Community Hub — Guild home
├── Announcements                    # text
├── General                          🔊 voice
└── Games                            📁 folder
    ├── Valheim                      ◇ Space
    │   ├── Home
    │   ├── Expedition planning      # text
    │   └── Expeditions              📁 folder
    │       └── Viking longhouse     🔊 voice
    └── Cyberpunk                    ◇ Space
        ├── Home
        ├── Builds                   # text
        └── Night City               🔊 voice
```

- **Hub:** owns the community, membership, default appearance, and top-level policies.
- **Folder:** organizes nested folders, Spaces, and channels.
- **Space:** provides a home, theme, delegated administration, access settings, and its own nested tree.
- **Channel:** a text or voice leaf with individual appearance and permission overrides.

Use a persistent, collapsible tree beside the active home or channel. Include familiar text/voice icons, selected-channel state, unread indicators, and voice participants. Keep member lists and administration contextual.

Support creation, renaming, reordering, moving, and archiving. Provide keyboard alternatives to drag-and-drop, breadcrumbs, and search that reveals matching ancestors. Moves retain channel IDs, messages, and drafts; reject cycles and unauthorized destinations.

**Home pages use placement presets**, rather than a freeform builder:

- Compact community overview.
- Banner-led guild home.
- Split introduction and activity layout.

Owners choose a preset and configure its supported content: identity, welcome text, featured Spaces/channels, announcements, and recent activity.

## 2. Owner-controlled access

Owners configure whether each Space is accessible to all hub members, joinable, approval-based, invitation-only, or restricted to selected roles and members.

- Hub membership remains the root membership boundary.
- Restrictions inherit through the tree. A child cannot bypass an ancestor’s access restriction.
- Owners can delegate Space management without granting control over sibling Spaces or the hub.
- Separate permissions govern viewing, posting, joining voice, speaking, moderation, structure, themes, and role management.
- Preserve the existing requirement for configurable authority brackets, including equal-authority roles. Equal-authority moderation is disabled by default and explicitly configurable.
- Hide inaccessible content from search, activity, unread totals, previews, and participant listings.
- Preview effective access as a selected role/member before saving permission changes.

Local stages clearly label permission previews. The live service enforces every operation, including history reads, asset access, subscriptions, and ongoing voice access.

## 3. Theme Studio and marketplace contract

Build a shared theme engine and integrated **Theme Studio**, with selection and live preview at hub, Space, and channel scope.

**Creator controls**

- Semantic colors for text, buttons, inputs, surfaces, highlights, and status indicators.
- Fonts, typography, spacing, density, borders, corners, shadows, and component variants.
- Background artwork, textures, overlays, custom card frames, decorative assets, and bounded motion effects.
- Supported home and room layout presets.
- Advanced CSS targeting documented component slots, with validated properties and managed asset references.
- Drafts, undo/redo, save/discard, duplication, reset, and desktop/narrow-window previews.

Functional elements retain app-owned behavior and accessible semantics. Themes cannot execute JavaScript, replace controls with arbitrary HTML, fetch external resources, or cover essential navigation and call controls.

**Inheritance**

Each scope chooses either **inherit** or a specific theme package. Choosing a package starts from the standard component baseline, avoiding accidental mixtures between unrelated styles. Scope overrides apply afterward; personal accessibility preferences apply last.

**Showcase themes**

Ship the neutral Vumiro baseline plus two original demonstrations:

- Viking-inspired: carved frames, weathered textures, warm light, restrained ornamental typography.
- Cyberpunk-inspired: angular panels, neon accents, technical typography, and controlled animated details.

Use original or appropriately licensed assets. These demonstrate creative range rather than establish a large preset catalog.

**Portable interface**

Define a versioned `.vumirotheme` package containing metadata, compatibility requirements, semantic tokens, component styles, supported layout choices, scoped CSS, assets, and previews.

Keep theme application separate:

- `ThemePackage`: portable styling and assets.
- `ThemeBinding`: package version, target hub/Space/channel, and local overrides.
- Shared operations: validate, preview, install, apply, export, and uninstall.
- Updates install alongside the previous version; switching supports rollback.

Packages exclude community IDs, conversations, members, permissions, and invitations.

The marketplace plan owns listings, publishing, discovery, purchases, entitlements, reviews, and payouts. It consumes the same validator and installation interface as local imports. Theme creation and file-based installation work independently of marketplace availability.

Provide an open creator kit with format documentation, starter packages, component-slot references, and command-line validation/packaging. Direct design-tool import and AI generation remain later integrations.

## 4. Implementation sequence

1. **Tree workspace and migration.** Extract tree/state/rendering responsibilities from the existing sandbox module. Migrate flat categories into folders while preserving channel IDs, messages, drafts, and identity isolation. Retain the original data until migration succeeds. Rename visible community terminology without renaming unrelated backend servers or compatibility identifiers.

2. **Homes and management.** Deliver placement presets, multiple hubs, Spaces, tree editing, theme/access bindings, and local permission previews. Existing simulated members and voice remain explicitly labeled.

3. **Theme engine and Studio.** Use an isolated community styling root so global app styles cannot defeat or escape themes. Store theme assets separately in IndexedDB. Add import/export, creator tools, showcase packages, and shared Windows/Linux asset packaging.

4. **Live communities and text.** Extend the existing Cloudflare backend with a dedicated hub Durable Object owning persistent structure, memberships, authorization, channel history, and authorized event streams. Reuse established identity authentication patterns. Add invitations, reconnect/history recovery, moderation, audit records, revision-checked edits, and permission revocation. Publish shared theme assets through authenticated object storage. Local demos require an explicit publishing action and never upload automatically.

5. **Persistent community voice.** Add a separate community media adapter using Cloudflare Realtime SFU, with backend-authorized publishing/subscribing and explicit session cleanup. This supports custom room presentation while leaving media routing to the service. Cloudflare documents this application-owned authorization model in its [SFU overview](https://developers.cloudflare.com/realtime/sfu/). Transfer theme context explicitly into the call surface.

Each stage ends in a usable LOCAL QA build. Infrastructure configuration and production release follow the repository’s existing release process.

## 5. Verification and defaults

- **Migration:** existing data survives reload, failed writes, interrupted migration, and identity switching.
- **Tree:** nested navigation, keyboard access, search, moves, archive restoration, draft preservation, and cycle prevention.
- **Permissions:** open and restricted Spaces, delegated leaders, equal-authority roles, ancestor restrictions, stale clients, and immediate revocation.
- **Themes:** inheritance/reset behavior, sharply different adjacent Spaces, export/import fidelity, rollback, missing assets, unsupported versions, and malicious CSS/archive rejection.
- **Usability:** readable text, visible focus, reduced motion, personal simplified styling, narrow layouts, and essential controls across all showcase themes.
- **Live:** owner-offline operation, reconnect without duplicated messages, concurrent-edit conflicts, unauthorized history/assets, and voice removal after access changes.

Initial validation targets **500 hub members, 100 simultaneous text connections, and 25 participants per voice channel**. These are release acceptance targets, subject to measured results before advertising capacity.

Run focused automated checks during implementation, expand checks for shared-shell changes, and perform visual/interaction QA in the real Windows app plus Linux compatibility checks. Record connection failures, authorization failures, and media-session cleanup without logging message contents or credentials.
