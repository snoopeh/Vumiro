# Calls, account continuity and chat foundations — 2026-11-10

The user authorized implementation and delegated design choices, including proceeding without approval gates. Work stays in this checkout, preserves installed profiles and does not publish a release or deploy services.

## Decisions

- Incoming calls reuse the existing signed invitations and join/decline flow, adding a caller card and bounded ringing controlled by existing sound settings.
- Account restore must finish before the lobby can treat an empty device as authoritative. Existing meaningful unbacked data remains protected from silent replacement.
- Preserve original GIF bytes, prefer original animated clipboard URLs where available, and initially load public metadata on request. Superseded by the follow-up: automatic public previews with plain-link fallback and composer attachment drafts.
- Show the existing launch artwork once per native process, including restored signed-in sessions. Respect reduced motion and a local disable-animation preference.
- Add a supporter screen with a configurable PayPal payment link; leave payment disabled until the owner supplies a verified destination.
- Add an account-identity-scoped IndexedDB chat archive and a versioned interchangeable storage API. A dependency-free Node 24 SQLite service provides local/private hosting; it is an optional archive, separate from live peer signaling and account backup. Each archive owner has its own bearer token. Clients verify signed messages again on replay.
- Persist signed text and attachment metadata first. Attachment bytes/object storage, full server membership/moderation, offline delivery, automatic host migration and a managed service remain later slices. Community server/channel records establish the schema without pretending these features are complete.
- SQLite WAL is the initial single-host implementation; stable API boundaries permit a PostgreSQL implementation when sustained concurrent writes warrant it. Moving hosts requires explicit data export/import, not simply changing a URL.

## Implementation and checks

1. Focused regression tests and fixes for account sync, calls and GIF/link cards in independently owned modules.
2. Launch lifecycle and disable-animation setting, with native process identifiers on both hosts.
3. Supporter screen and safe configuration boundary for the eventual PayPal link.
4. Local archive, private service, server/channel records, storage settings, pagination and namespace isolation tests.
5. Shared-asset packaging/trusted-route integration, fresh client/backend/native checks, local build and isolated LOCAL QA handoff. Automated checks establish readiness for human QA, not acceptance or release.
