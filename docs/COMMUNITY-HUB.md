# Community Hub

The former Servers entry opens a persistent tree of hubs, folders, independently themed Spaces, and text/voice channels. The legacy `servers` route, DOM identifiers, sandbox API and storage keys remain compatibility boundaries; unrelated backend server settings retain their names.

## Local workspace

Each signing identity owns a separate v2 local store. Existing category labels migrate into folders. Channel IDs, selected conversations, messages and drafts survive migration and moves. The old snapshot and backup remain intact; migration writes are read back before being reported saved. Storage failures keep usable edits in memory and display an unsaved status.

Select a hub or create another in Manage. Expand/collapse the tree, use arrow keys/Home/End, or search to reveal matching ancestors. Space headers and channel rows offer contextual plus/gear controls. The plus opens creation in that exact container; the gear opens scoped settings for renaming, moving, ordering, archiving and restoring. Hub settings also provide multiple-hub management. Moves retain history and drafts and reject cycles and unauthorized destinations. Homes offer compact, banner and split presets, welcome copy, announcements and featured destinations.

Scoped settings separate channel details, access, appearance and connections. Permission outcomes use readable allowed/denied rows; invitation links or codes can be pasted into Connections. Local access screens are explicitly **permission previews**. Owners configure Space access, separate operation permissions, delegated management and authority brackets. Equal-authority moderation starts disabled. Unsaved policies can be previewed for a member before saving. Simulated members and local voice previews remain labeled. They never join real calls or use the friends transport.

## Themes

Community content uses a Shadow DOM styling boundary. Theme Studio supports package selection, semantic tokens, typography, spacing/density, visual component slots, supported layouts, bounded motion, raster artwork, advanced validated CSS, draft history, save/discard/reset/duplicate, import/export and narrow previews. Personal simplified styling, high contrast and reduced motion apply last.

The baseline, Ember & Oak and Signal / Neon packages demonstrate distinct visual styles. A selected package resets to the standard component baseline; inherited bindings preserve parent styling, then scope overrides apply. Assets and artwork drafts use IndexedDB; lightweight metadata and scope bindings stay separate. An inaccessible storage backend is reported and portable export remains available.

See [the creator kit](THEME-CREATOR-KIT.md) for `.vumirotheme`, starter packages and the shared validator/packaging CLI. JSON packages deliberately reject ZIP archives, scripts, arbitrary markup, external resources, global selectors and geometry that could cover essential controls. Local imports and creator tools work without a marketplace.

## Shared communities

Connections offers explicit publication or connection by community ID and optional invitation token. Publishing transfers structure, access settings and theme bindings, excluding local conversations, drafts and simulated members. The conversation frame keeps its composer at the bottom while history scrolls independently. Enter sends; Shift+Enter inserts a line; IME composition does not submit. Voice rows join inline without replacing the selected conversation, and a persistent sidebar dock retains mute/disconnect and participant state. Local voice stays explicitly simulated. Narrow screens use a channel drawer.

A shared composer uses signed requests and stable retry IDs, displays durable history, recovers events, and preserves device drafts independently of the demo.

Shared Manage exposes home presets, ordering, archive discovery/restoration, access modes, delegated managers, per-role permission dimensions, authority brackets, member roles and invitations. Pending Space approvals are reviewed by authorized managers. Message removal uses service moderation and author authority checks. Shared theme assets are validated, authenticated and kept in an identity-isolated session cache.

The service owns persistent membership, structure, history, authorization, revision conflicts, moderation, audit records and authenticated R2 asset access. Permissions apply to every history/event/asset/media request and are checked again after asynchronous operations. Revocation closes unauthorized subscriptions and media allocations. Voice uses its own Cloudflare Realtime SFU adapter and receives theme context explicitly. Hiding the workspace stops capture and completes media cleanup before disconnecting the transport.

See [service configuration and protocol](COMMUNITY-SERVICE.md). The R2 bucket, Durable Object migration and SFU credentials require environment provisioning; this implementation does not deploy them or change production data. SFU device/network behavior and the 500-member / 100-text-connection / 25-voice-participant acceptance targets require measured validation before release or capacity claims.

## Verification

- `node scripts/Check-Client.mjs --group chat` runs focused UI/model/theme/transport checks and backend tests.
- `./scripts/Run-Local.ps1` runs the full client/native gate and opens the real Windows LOCAL QA app.
- For isolated shared testing, run the local Worker as documented in [local development](LOCAL-DEVELOPMENT.md), then `./scripts/Run-Local.ps1 -LocalService`.
- `node scripts/Test-CommunityService.mjs` runs signed HTTP/WebSocket/R2 integration checks against the local Worker using generated test identities. It records counts/statuses, never credentials or message bodies, in `dist/community-service-qa.json`.
- Linux trusted-route, packaging and smoke-contract checks run in the full suite. Actual Linux app/device QA and production SFU QA remain separate acceptance work.

Automated checks and agent-operated interaction checks establish implementation readiness, not human acceptance or a release.
