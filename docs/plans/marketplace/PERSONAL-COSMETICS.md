# Marketplace customization hierarchy

The user's follow-up expands the marketplace beyond community themes to individual user cards, profile pictures, and animated profile decoration. This supersedes the earlier decision to defer personal cosmetics. All implementation stays in the existing isolated `Vumiro-Marketplace` checkout on `codex/marketplace`; other agents' checkouts are untouched.

## Delivered categories

| Category | Package kind | Destination |
| --- | --- | --- |
| Community Hub designs | theme | Root hub appearance |
| Space themes | theme | Space appearance |
| Channel themes | theme | Text or voice room appearance |
| Decorative packs | decorative-pack | Documented community component slots |
| User card frames | profile-card | Account user card and profile perimeter |
| Avatar frames | avatar-frame | Account profile picture perimeter |
| Profile effects | profile-effect | Account profile decoration |

Community Hub designs cover the existing portable visual layout/theme contract. This extension does not provision channel structures, roles, permission rules, bots, or arbitrary server scripts.

Personal cosmetics share the existing portable validator, installation manager, creator workspace, moderation, free acquisition, and paid commerce contracts. A personal package cannot target community controls or override global typography/layout. Community packages cannot target personal slots. Original examples include Celestial Orbit, Ember Crown, Neon Circuit, Gilded Portrait, Prismatic Card, and Aurora Drift. The shared Studio starts personal drafts, limits component controls to the package kind, and previews/exports the same portable format.

## Ownership and display

Each stable account has independent avatar-frame, profile-card, and profile-effect slots. Personal equipment requires an active entitlement and an approved matching package. It does not require community membership and consumes none of the five root-hub sponsorship slots. Equip, reset, and one-step undo are server operations. Revoked or dangerously disabled artwork falls back to the ordinary profile while saved configuration remains recoverable.

The existing signed peer-profile and account backup schemas remain unchanged. A short-lived, one-use challenge proves control of the existing P-256 peer identity before linking it to the account. The public display route exposes current validated appearance only, without account IDs, emails, orders, or tokens. Display access confers no equipment or acquisition rights. Client request closures must remain bound to their originating account/store so a delayed operation cannot mutate a later account.

The renderer decorates existing avatar and user-card surfaces with pointer-inert, masked perimeter layers. It retains the real image, names, text, and controls. Bounded CSS motion has static reduced-motion fallbacks; embedded raster decoration is also suppressed under reduced motion because GIF, APNG, and WebP playback cannot be stopped with CSS. Simplified and high-contrast preferences suppress decorative layers. Failed own identity linking must not stop other users' public appearance refresh or expiry checks.

## Delivery boundary

Source implementation and local SQLite/native checks do not deploy the marketplace or activate live payments. Production still requires the marketplace database migrations and isolated service bindings, the account gateway configuration, and the Community Hub authority adapter described in the original handoff. Local-demo equipment affects simulated account state only and never publishes real profile ownership.

API, rendering, and client details are in `docs/MARKETPLACE-PERSONAL.md`, `docs/PROFILE-COSMETICS.md`, and `docs/MARKETPLACE-CLIENT.md`. Verification results and native screenshots are recorded in `PROGRESS.md` and the ignored `dist/` receipts.
