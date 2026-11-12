# Marketplace API and licensing contract

Source implementation: `cloudflare/marketplace.js`, the separate `marketplace-worker.js`, `wrangler.marketplace.jsonc`, and `marketplace-migrations/`. Nothing in this change deploys a service or enables real payments. The configuration deliberately contains database/account project placeholders. Apply marketplace migrations only to a separate `MARKETPLACE_DB`; never apply them to `ACCOUNT_DB`.

## Identity and storage

All public endpoints below use `/api/v1/marketplace` and the existing account service's `Authorization: Bearer <JWT>` authentication. The account UUID comes only from `accounts.js:authenticate`; peer IDs, device IDs, account IDs in JSON, and browser return URLs cannot establish ownership. Moderator account UUIDs are configured server-side in the comma-separated `MARKETPLACE_ADMIN_ACCOUNTS` variable.

`MARKETPLACE_ASSETS` is a private R2 bucket with no public domain, `r2.dev`, or static-assets binding. Versions store an immutable private object key and SHA-256 digest. Package content is validated with the same `marketplace-package.js` bridge and actual Theme Studio engine used by the client. Every served preview, download, moderator package read and override validation recomputes the digest and rejects changed/corrupt content. Request bodies are streamed with a limit of 2 MiB plus 16 KiB for submission metadata; the shared engine independently enforces its package and raster-asset limits.

Listings, package versions, metadata revisions, account entitlements, root-hub grants, scoped theme bindings, membership event receipts, moderation cases, and audit entries are separate records. The commerce migration owns provider accounts, orders, immutable financial ledger entries, payment event receipts and refund requests. Timestamps are epoch milliseconds; listing currencies use uppercase ISO currency codes, while commerce normalizes provider amounts and currency snapshots.

## Account, creator and acquisition routes

| Method and path | Body / result |
| --- | --- |
| `GET /catalog` | `{items:[...]}` published listing summaries, including `creator_name`, reviewed `aesthetic`, server price, `latest_version_id`, and immutable package capabilities; currently the 100 most recently updated listings. |
| `GET /library` | `{entitlements,items,versions,grants}` for the authenticated account. Includes owned delisted metadata and all known versions up to the bounded response limits. Grants include `effective_status`; a past `grace_until` is effective immediately. Library display data never authorizes installation. |
| `GET /items/:itemId` | `{item,versions}`; owners/moderators additionally get metadata `revisions` and pending/rejected version feedback. Unpublished/delisted details are hidden from unrelated accounts; licensed clients use library metadata and authorized downloads. |
| `POST /items/:itemId/claim` | `{}` returns `{entitlement}` (201 new, 200 existing). A free claim bypasses every commerce check and creates one account/item entitlement. Existing active entitlements survive later pricing and ordinary delisting. A revoked entitlement cannot be reclaimed for free. |
| `POST /creators/enroll` | `{displayName,rightsAccepted:true}` returns `{creator}`. Enrollment is open to authenticated accounts; paid publication separately requires verified provider onboarding. |
| `GET /creator/items` | `{items}` for the authenticated creator, including draft/delisted/disabled entries. |
| `POST /items` | `{title,description,priceMinor,currency,aesthetic?}` creates `{item}` in `draft`. Aesthetic labels are bounded lowercase slugs of 1–32 characters, defaulting to `community`. |
| `POST /items/:itemId/versions` | `{package,rights:{ownsOrLicensed:true,permitsRedistribution:true,declaration}}` creates `{version}` in `submitted`. A package version cannot be overwritten; another package requires a new version. Submission does not replace the current approved version. |
| `POST /items/:itemId/revisions` | `{title,description,priceMinor,currency,aesthetic?}` creates an immutable `{revision}` in `submitted`. Live metadata/pricing/aesthetic stays unchanged until moderator approval; an omitted aesthetic preserves the existing label. |
| `GET /versions/:versionId/preview` | `{package,previewOnly:true,licenseNotice}` for an approved version of a published listing. Preview explicitly exposes validated theme content to enable the real engine's interactive preview. It does not grant ownership, installation, sponsorship or redistribution/resale rights. Preview is a licensing boundary, not DRM against copying browser-visible artwork/CSS. |
| `GET /versions/:versionId/download` | Raw validated `.vumirotheme` JSON; requires an active account entitlement, or the hub-scoped authorization described below. Includes `X-Vumiro-Package-Digest`. All responses use private/no-store caching. |

New claims fail with 409 when an item is paid, delisted, or lacks an approved package. Disabled content cannot be downloaded or applied even when ownership is retained.

Catalog, item details, creator listings, library listings and version metadata expose `summary:{kind,engine,slots,scopes}`, with flattened `kind`, `slots`, `scopes` and `compatibility:{engine}` for consumers. The summary is derived once from the validated package and SQL-immutable with its version. Slots combine actual component keys and documented CSS slot selectors, so CSS-only decorative slots are represented. The current portable engine supports all four scope types (`hub`, `space`, `text`, `voice`); decorative application still requires the target to expose every required slot. Summary metadata contains no artwork or external URLs and is available before acquisition for type, capability and compatibility filters. The client uses the summary ahead of fallback display fields.

## Sponsorship, scopes and fallback

An active account entitlement allows the holder to explicitly sponsor up to **five canonical root hubs per item across all versions**. Descendant Spaces/text/voice channels share that root slot. Root IDs are resolved by the trusted service; a client cannot invent a root to evade the limit. SQLite triggers enforce the limit atomically, including competing inserts/reactivations. Grace grants occupy slots; expired grace stops occupying a slot before any cleanup job runs.

| Method and path | Behavior |
| --- | --- |
| `POST /items/:itemId/grants` | `{hubId}` returns `{grant}`. Requires current server-confirmed membership and ownership. Repeating a current root grant is idempotent. Sponsorship does not apply a theme. |
| `DELETE /grants/:grantId` | Holder-only immediate withdrawal. It requires neither current membership nor manager authority. |
| `GET /hubs/:hubId/theme?scopeId=:node&scopeKind=:kind` | `{binding,configuration}`. `binding` is null when no current sponsorship authorizes the saved version. `configuration` preserves its version/overrides during fallback. Defaults to root scope; other kinds are `space`, `text`, `voice`. |
| `PUT /hubs/:hubId/theme` | `{itemId,versionId,scopeId?,scopeKind?,overrides?}` applies only after server-confirmed management authority for the target node and a valid root sponsorship from any holder. |
| `DELETE /hubs/:hubId/theme?scopeId=:node` | Manager-only reset to inherited/default appearance; preserves one reset undo record. |
| `POST /hubs/:hubId/theme/undo` | `{scopeId?,scopeKind?}` restores the previous configuration or the default before the first application. It also restores a reset. An unlicensed restored configuration remains saved but resolves to fallback. |

Overrides use the shared engine's exact `{tokens,components,layout}` contract and are checked against the actual integrity-verified package. No parallel CSS validator exists. Scope IDs and the declared kind are hints to the authority service; that service must derive and validate the real target and root from persisted hub state.

For a member without personal ownership, `GET /versions/:id/download?hubId=:root&scopeId=:node&scopeKind=:kind` permits the active installed version at that target. A current theme manager may also download approved versions of an explicitly sponsored item before activation or update. The backend derives membership, target authority and the active sponsorship; this access never creates a personal entitlement or permits re-sponsorship.

Membership removal starts a 24-hour grace from the source event's `occurredAt`, not from delayed delivery time. Rejoining during grace cancels it. A holder losing manager authority while remaining a member has no effect on sponsorship. Withdrawal and refunded/lost-dispute entitlements revoke authorization immediately. Another valid holder's grant prevents fallback. Fallback does not destroy custom configuration, overrides, or other holders' entitlements.

## Trusted hub authority and reconciliation

Deployment requires a separate `MARKETPLACE_HUBS` service-binding adapter backed by durable CommunityHub state and a server-established mapping from stable account UUIDs to hub membership identities. The current CommunityHub uses peer identities; trusting a client-provided UUID/peer association would be unsafe. The adapter and durable event feed must exist before hub licensing is operational. Missing/unavailable authority or reconciliation returns 503, never a permissive local answer.

The adapter authenticates every internal request with `Authorization: Bearer <MARKETPLACE_INTERNAL_SECRET>` (minimum 32 characters, stored as a secret on both services):

* `POST /internal/marketplace/authorize` receives `{accountId,hubId,scopeId,scopeKind}` and returns `{rootHubId,member:boolean,canManage:boolean}`. Management applies to the requested target, not merely to the root. It must derive actual membership, scope type, permissions and root from server records.
* `GET /internal/marketplace/events?cursor=<opaque>&limit=100` returns `{events,cursor,hasMore}`. A page with `hasMore:false` confirms catch-up through a durable source high-watermark. The cursor must refer to an ordered, replayable event stream and cannot skip committed membership changes. Retain source history until consumers can safely bootstrap or resynchronize.
* Source membership transitions may also push `POST /api/v1/marketplace/internal/events` with `{eventId,sequence,rootHubId,accountId,member,occurredAt}` using the same secret. Sequence increases strictly per root/account; role-only changes produce no removal transition. Event IDs and `(root,account,sequence)` are unique. Stale/conflicting/replayed events cannot reverse a later rejoin.

Before serving hub bindings, accepting sponsorships, or serving a download through a hub, the backend pulls/replays up to eight 100-event pages and advances its durable cursor with compare-and-swap. Event receipt/state changes are transactional; advancing after applied receipts makes crash replay safe. Source unavailability, malformed feeds and an unprocessed backlog fail closed. Hourly maintenance performs the same reconciliation and marks overdue grace rows `expired`, retaining their source deadline separately from voluntary `withdrawn` grants. A durable rejoin that occurred within grace restores the grant even when delivered after cleanup; an actual withdrawal or refund never restores. If a historical correction would exceed five current slots, SQL rejects the transaction and reconciliation cannot advance or authorize hub use until that conflict is resolved. Access predicates independently enforce grace deadlines; scheduled cleanup is not an authorization prerequisite.

## Review and audit

`POST /reports {itemId,reason}` creates a case; `POST /items/:id/appeals {reason}` requires the listing's creator. Moderator-only routes:

* `GET /admin/queue` returns pending versions/revisions and open reports/appeals.
* `GET /admin/versions/:id/package` serves validated, integrity-checked submitted content privately for review.
* `POST /admin/versions/:id {action:'approve'|'reject'|'disable',reason}` records a decision. Approval of a submitted version publishes it; paid versions require verified provider onboarding. Rejection leaves earlier approved content intact.
* `POST /admin/revisions/:id {action:'approve'|'reject',reason}` reviews metadata/pricing while preserving live state until approval. Paid pricing requires verified provider onboarding.
* `POST /admin/items/:id {action:'delist'|'disable',reason}` distinguishes ordinary catalog removal from dangerous content disablement. Delisting preserves licensed use; disablement blocks serving and forces licensed scopes to fallback.
* `POST /admin/reports/:id` and `/admin/appeals/:id` accept `{status:'resolved'|'dismissed',reason}`.
* `GET /admin/metrics` returns allowlisted daily/item aggregates and average package publication lead time. It contains no account, hub, Space, channel or private-message content. Metrics are best effort and cannot affect licensing/payment outcomes.

Mutations record audit actions with actor/target identifiers and relevant decisions; private hub content is never copied into the marketplace database. Apply operator retention and access policies to audit/case records and storage orphans. A failed submission after R2 upload may leave an unreferenced object; remove objects only after confirming no version references them.

Commerce routes live under `/commerce/*` with provider-signed `/webhooks/stripe`. See [MARKETPLACE-COMMERCE.md](MARKETPLACE-COMMERCE.md) and its tests for the sandbox-only provider boundary and order/ledger rules. Required sandbox configuration includes `MARKETPLACE_COMMERCE_MODE=sandbox`, `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET`, and `MARKETPLACE_RETURN_URL=https://<account API origin>/api/v1/marketplace/return` routed through the account service gateway. The return page permits unauthenticated GET/HEAD, ignores query parameters, and tells the user to return to the desktop app. Other methods return 405. Browser success navigation never issues an entitlement. Production payments remain unavailable.

## Validation and operational limits

Run `node --test cloudflare/marketplace.test.js cloudflare/marketplace-commerce.test.js tests/marketplace-model.test.mjs` from the repository root. The tests execute all marketplace SQL migrations against real `node:sqlite`, sign actual account JWTs, exercise slot triggers directly and through concurrent requests, and run the real browser model/shared installer against the Worker. This covers code contracts; it does not establish a deployed hub adapter, provider credentials, payment behavior in production, or human QA acceptance.

Configure Cloudflare routing, private bucket policies, operator monitoring and abuse/rate controls before deployment. Current catalog/library/review responses are deliberately bounded (100 catalog/review rows, 500 entitlements/listings, 2,500 library version/grant rows); pagination and historical export beyond those bounds remain future work. There is no automatic production deployment in the client launcher.
