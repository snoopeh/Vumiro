# Personal marketplace appearance

Personal cosmetics use the existing reviewed marketplace packages and account entitlements. The portable kinds are `profile-card`, `avatar-frame`, and `profile-effect`. They use independent account slots and never consume any of the five shared hub sponsorship slots. Free acquisition uses the existing `/items/:itemId/claim` route; paid acquisition uses the existing verified commerce flow. A public package returned for rendering is display access only and cannot authorize installation, acquisition, personal equipment, or community sponsorship.

Apply `cloudflare/marketplace-migrations/0004_personal_cosmetics.sql` to the separate marketplace database alongside its preceding migrations when preparing the service. This migration creates account bindings, peer identity links, and short-lived challenge receipts; it does not change the account database, signed peer-profile wire format, or account backup schema. Implementation and local tests do not deploy the service.

All paths below are relative to `/api/v1/marketplace`. Private routes require the existing verified account JWT. The server derives the account subject from that JWT; asserted account IDs, ownership flags, recovery metadata, and cached client receipts confer no authority.

| Method | Path | Request | Result |
| --- | --- | --- | --- |
| GET | `/profile/appearance` | — | Current effective appearance and saved configuration |
| PUT | `/profile/appearance/:kind` | `{itemId, versionId}` | Equip one owned, approved package of the matching personal kind |
| DELETE | `/profile/appearance/:kind` | — | Reset that kind to baseline; preserve one undo step |
| POST | `/profile/appearance/:kind/undo` | `{}` | Swap the saved previous selection with the current selection |
| POST | `/profile/identity/challenge` | `{peerId, key}` | `{challengeId, text, expires}`; status 201 |
| POST | `/profile/identity/verify` | `{challengeId, signature}` | `{linked:true, peerId}` |
| GET | `/profiles/:peerId/appearance` | No account credentials required | Public effective appearance for a proven peer identity |

`:kind` must be one of the three personal package kinds. Private appearance responses and successful equip/reset/undo responses have this shape:

```json
{
  "appearance": {
    "profile-card": null,
    "avatar-frame": {
      "kind": "avatar-frame",
      "itemId": "item-id",
      "versionId": "immutable-version-id",
      "digest": "sha256-hex",
      "package": {}
    },
    "profile-effect": null
  },
  "configuration": {
    "profile-card": null,
    "avatar-frame": {
      "itemId": "item-id",
      "versionId": "immutable-version-id",
      "updatedAt": 1794350000000
    },
    "profile-effect": null
  },
  "licenseNotice": "Authorized for profile display only. Display access does not grant ownership, installation, sponsorship, redistribution, or resale rights; the creator license still applies."
}
```

The example's `package` placeholder contains the complete validated portable package in a real response. `appearance` always contains exactly the three documented kind keys, each either an active entry or `null`. `configuration` records a saved selection even when effective styling is unavailable. A reset makes both values `null` for that kind until undo or a new equip. Undo can restore a revoked selection as configuration; it cannot restore permission to render it.

Public responses contain only `appearance` and `licenseNotice`. They contain no stable account ID, account email, orders, entitlements, private library, tokens, previous configuration, or challenge metadata. An unknown or unlinked well-formed peer ID returns the same empty baseline as a linked account with no effective cosmetics. Each package is bounded by the shared validator and package reader; each response contains at most three packages. All responses use `Cache-Control: no-store`.

The active lookup requires an active entitlement, an approved immutable version associated with the selected listing, a listing that has not been dangerously disabled, a matching personal package kind, shared package validation, and the stored SHA-256 digest. It rechecks authority after asynchronous object storage access. Refund or lost-dispute entitlement revocation, version disablement, and dangerous listing disablement remove effective cosmetics without a grace period. Ordinary delisting preserves existing legitimate use while preventing new free claims. A missing, corrupted, or unavailable package falls back independently so it cannot remove another valid kind. Saved selection and undo data remain available for recovery. These cosmetics decorate the existing profile and avatar surfaces and do not replace real profile media.

Identity challenge text is the server's exact compact JSON serialization of:

```text
["vumiro-profile-cosmetics-v1", accountId, peerId, key, nonce, expires]
```

The browser signs `text` verbatim with `VumiroLocalProfile.sign(text)`. `VumiroLocalProfile.profile()` supplies `id` as `peerId` and `key` as a base64url P-256 DER SPKI public key. The server verifies that `base64url(SHA256(SPKI))` equals the 43-character peer ID and verifies the ECDSA P-256 SHA-256 signature as a 64-byte raw `r || s` base64url value. It accepts only fresh, account-bound, unused challenges, with a maximum lifetime of 60 seconds and eight issues per account per minute. Completion and identity linking use one transaction with a unique claim token so simultaneous verification cannot replay a proof. The peer-ID primary key prevents another account from taking an existing link; an account can prove multiple signing identities.

Profile rendering should request the public route through the trusted account-origin marketplace gateway over TLS and treat current server status as authoritative. On any fetch, validation, or authority error, show the baseline for the affected kind. Public display data must never become a local acquisition receipt, hub grant, or replacement signed profile field.

Focused backend verification:

```powershell
cd cloudflare
node --test marketplace.test.js marketplace-commerce.test.js marketplace-gateway.test.js marketplace-metrics.test.js marketplace-return.test.js
```

The tests use real in-memory SQLite migrations and WebCrypto signing. Automated checks establish implementation readiness; production migration, deployment, and human profile/avatar QA remain separate release work.
