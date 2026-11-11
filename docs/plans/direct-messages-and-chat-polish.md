# Direct messaging and chat experience — 2026-11-10

The user superseded the first preview/paste design with Discord-like composer attachments, automatic standard embeds, unobtrusive reply actions, and foreground-centered call acceptance that opens the actual room. They also requested persistent direct messages to offline friends. Existing authorization delegates implementation decisions; no approval gates or production release/deployment are implied.

## Delivery

- Room image paste stages a removable image/GIF draft and preserves original bytes/animation. Send submits the draft; failures retain it. Public image links display images without Load image controls.
- Page previews load automatically on supported sites, use real titles/header images, and disappear into the ordinary link when unavailable. No Retry preview error cards. Reply actions appear on interaction and remain keyboard accessible.
- Foreground incoming calls use a centered card. Acceptance respects unsaved settings and brings the connected caller's room forward, closing safe covering dialogs. Native notification activation restores the app and exposes the explicit choice.
- Friend direct conversations live outside call UI. A Messages navigation entry, friend Message actions, conversation list, history, composer, stored/sending/failed status, and unread indicators form the first usable text-message slice.
- The authenticated directory WebSocket brokers signed messages, paginated history and inbox summaries. Persist authenticated friend/block state for offline admission. Separate SQLite Durable Objects own conversation history; identity proof and mutual-friend/block checks gate sends and participant-only reads.
- The client verifies signed participant envelopes before display and caches accepted messages locally per signing identity. A server acknowledgment means stored, not delivered/read. Unsupported or unreachable services show a clear unavailable state and keep the draft.

## Limits and rollout

Offline recipient delivery requires an always-on service. A local archive on a powered-off computer cannot provide it. The existing Cloudflare service can host the initial mailbox layer; the protocol/storage boundary remains replaceable for self-hosting. This change provisions no paid service, deploys no production binding and promises no unlimited free quota. Direct-message attachments, end-to-end encryption, push delivery to a fully closed app, group/community membership and a turnkey self-hosted mailbox distribution are later slices. Signed messages protect author authenticity but remain readable to the storage operator.

Run behavioral regressions for composer drafts, preview fallback, call navigation, participant authorization, duplicate sends, blocked/offline users, server restart/history and cross-identity cache isolation. Then run the full client/backend/native checks and use the real LOCAL QA app against an isolated local Worker. Preserve installed profiles and existing uncommitted changes.
