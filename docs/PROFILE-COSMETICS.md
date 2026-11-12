# Personal profile cosmetics

`profile-cosmetics.js` renders approved personal appearance in the existing friends interface. The common avatar helper covers the sidebar, profile editor, friend rows, contact details, requests and direct-chat header. The existing user-card dialog receives card decoration after its identity and controls are rendered.

## Renderer contract

`window.VumiroProfileCosmetics` exposes:

- `previewAvatar(element, package, {preferences})` and `previewCard(element, package, {preferences})`: validate through `VumiroCommunityThemes`, render a local sample, and return an idempotent cleanup. Preview never grants ownership, changes equipment, or publishes a profile.
- `decorateAvatar(element, person)` and `decorateCard(element, person)`: resolve current public service appearance for `person.id`, returning a promise for cleanup. Appearance embedded in a peer profile is ignored.
- `refreshOwn()`: reconcile active surfaces, prove the current account's local signing identity when needed, fetch current public appearance and emit `vumiro-profile-cosmetics-updated`.
- `configure({preferences: () => ({simplified, highContrast, reducedMotion})})`: supply app preferences and reconcile active surfaces.
- `dispose()`: clear live surfaces, pending generations and cache.

Personal packages use the shared engine's schema and documented personal slots. The renderer applies the engine only to newly created, `aria-hidden` decorative spans. Portrait images, initials, names, presence indicators and functional controls remain the app's original nodes. Package CSS has no selector access to those nodes. Every decorative layer ignores pointer events and selection. Avatar paint is masked to a three-pixel ring immediately outside the portrait; card paint is masked to its three-pixel inner perimeter. Decorative spans cannot grow beyond these fixed bounds.

Motion comes from app CSS only: slow orbit brightness, shimmer, and pulse presets, plus the existing ember/scan aliases. No package JavaScript, HTML, custom keyframes, external fonts or remote asset URLs are accepted. Embedded raster object URLs are owned by the shared engine and revoked when a layer is removed. OS reduced motion stops animation; app simplified/high-contrast preferences and OS forced colors remove decorative layers, preserving the ordinary readable interface.

## Authority and reconciliation

Authenticated identity linking uses `POST /profile/identity/challenge` with `{peerId,key}`, signs the returned challenge text verbatim with the local nonextractable signing identity, and submits `{challengeId,signature}` to `POST /profile/identity/verify`. It rechecks the account and public identity after every asynchronous step. It never sends private keys or includes account data in public peer profiles.

Live rendering reads `GET /profiles/:peerId/appearance` through `VumiroAccount.publicMarketplaceRequest`, which owns the trusted service origin. Server responses determine current entitlement, moderation and equipment. Private identity linking is best effort: a failed or rate-limited proof still permits public appearance reconciliation and rearms expiry for active peers. The renderer does not infer ownership from an imported package, a peer's claims, local preview state, or a cached receipt.

Public results are cached for 30 seconds with at most 128 identities and in-flight request deduplication. Active targets are reconciled on expiry, focus, reconnect, account/identity changes and `vumiro-personal-appearance-changed`. Invalidation removes old paint before asynchronous work begins. Missing packages, revoked equipment, invalid packages and failed requests leave the original app content visible. Generations discard late responses for replaced identities, accounts, or reused avatar elements. The cosmetic event is separate from `vumiro-profile-changed`, so decoration does not trigger profile backup or peer-data publication.

This leaves local profile, backup and peer profile schemas unchanged. Try-on previews never save equipment. In local simulation, installed and applied personal items decorate the current user's own profile surfaces on this device. The renderer reuses the existing account-scoped marketplace store, validates saved packages and installed library versions, and restores selections after restart. Reset and undo refresh the real profile after persistence commits or rolls back. Local decorations are never published to peers, backed up as profile fields, or interpreted as live ownership. Sign-out and account changes clear them. An enabled live service never falls back to local equipment, including when its public transport is unavailable.

## Verification

Run `node --test tests/profile-cosmetics.test.mjs tests/profile-cosmetics-wiring.test.mjs` for executable renderer, real shared-validation, object URL cleanup, identity/account race, detached-row, public authority, revocation and integration checks. Windows/WebView2 human QA should still inspect small and large portraits, the user-card dialog, reduced motion, forced colors, action clicks, close/reopen, account switching and server revocation. Automated fixture checks do not establish visual acceptance.

Reduced-motion resolution also strips personal raster backgrounds and releases their artwork assets, retaining a static border/color/gradient fallback. This covers animated GIF, APNG, and WebP playback, which CSS animation suppression alone cannot stop.
