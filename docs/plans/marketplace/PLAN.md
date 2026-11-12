# Vumiro Marketplace: Themes and Decorative Packs

## 1. Product and commercial model

Build an integrated marketplace for discovering, previewing, acquiring, and applying Community Hub themes and decorative packs.

- Support **free and paid items**, with open creator enrollment and reviewed submissions.
- Keep Theme Studio, ordinary customization, and local import/export free.
- Start with complete themes and decorative packs for backgrounds, card frames, borders, textures, and supported effects.
- Use one-time purchases. Defer subscriptions, gifting, cross-creator carts, and unrelated profile cosmetics.
- Split net sale proceeds **85% to the creator and 15% to Vumiro**, after taxes, refunds, and payment-processing costs. Show deductions individually. Vumiro covers marketplace operating and payout-service costs from its share.
- Free acquisition creates a library entitlement without payment processing. Free pricing does not automatically permit redistribution or resale.

The business country is undecided. Build free distribution and sandbox commerce first; real payments require a separate business-setup milestone.

## 2. Library, hub grants, and expiration

Purchases and free claims belong to a stable Vumiro account, independently of device signing identities.

**Each acquired item can support five root Community Hubs simultaneously.** Spaces, folders, and channels within one hub share that hub’s grant and consume no additional slots. Different versions of an item share its limit.

| Situation | Behavior |
|---|---|
| Holder remains a hub member | Grant remains active. |
| Holder leaves, is kicked, or is banned | Start a 24-hour grace period from the server-recorded membership removal. |
| Holder rejoins before expiration | Cancel the countdown; retain the slot. |
| Grace period expires | Expire the grant and release its slot. |
| Holder explicitly withdraws a grant | Revoke immediately and release its slot. |
| Holder loses management authority but stays a member | Grant remains active. |
| Purchase is refunded or payment dispute is lost | Revoke the associated entitlement and grants without membership grace. |

Additional rules:

- Active grants and grants within their grace period count toward the five-hub limit.
- The holder must explicitly offer an item to a hub. Someone with theme-management permission activates it; membership alone never grants editing authority.
- Hub members can view the installed design without acquiring the item themselves.
- If another valid holder sponsors the same item, expiration of one sponsorship does not remove it.
- At expiration, replace unavailable styling with the built-in baseline, preserving content, structure, and saved customization settings.
- Show slot usage, sponsored hubs, expiration times, and immediate withdrawal controls in the holder’s library. Show affected grants to hub managers without exposing private purchase information.
- Enforce limits and expiration on the backend using server time. Concurrent requests cannot allocate a sixth slot.
- Installed offline copies check licensing on reconnection. Local clocks and cached receipts cannot authorize shared-hub grants.

These controls limit license sharing; verified accounts, acquisition limits, and abuse detection address automated account farming separately.

## 3. Buyer and creator experience

**Marketplace**

Provide Discover, Search, product pages, creator pages, and My Library. Filter by product type, aesthetic, price/free, supported scope, and compatibility. Use curated collections and transparent sorting without paid ranking in the first release.

Each product page includes:

- Accurate previews rendered through the real theme engine using sample community content.
- Included assets, supported components and layouts, compatibility, version history, creator, price, and license explanation.
- An interactive preview showing hub, Space, text-channel, and voice-channel presentation where supported.
- Clear separation between previewing, acquiring, installing, and applying.

Acquisition adds the item to the library. Applying it selects a hub and scope, checks permissions and available slots, and preserves the previous configuration for undo. Decorative packs target documented component slots rather than arbitrary interface elements.

**Creator dashboard**

Allow creators to register, create listings, upload packages, preview submissions, set free or paid pricing, submit revisions, and inspect review feedback.

- Use the existing Theme Studio export flow; do not build a second authoring system.
- Show sales, deductions, refunds, pending earnings, settled earnings, and payout status.
- Require payment-provider verification before enabling paid sales. Free creators do not need payout onboarding.
- Review new packages, asset changes, and substantive listing revisions before publication. Existing approved versions remain available while updates are reviewed.
- Preserve existing entitlements when a free item becomes paid or its price changes.
- Permit personal customization and backups. Marketplace publication of derivatives requires rights to redistribute every included asset.

**Review and moderation**

Check package validity, compatibility, content, asset rights declarations, preview accuracy, and prohibited behavior. Provide reporting, reviewer decisions, appeals, and an audit trail.

Ordinary delisting stops new acquisitions while preserving existing licensed use. Dangerous or infringing versions follow a separate disablement and remediation process. Seller suspension alone does not silently erase legitimate purchases.

## 4. Shared contracts, backend, and payments

**Community Hub integration**

Reuse the same package validator, asset resolver, renderer, installer, and version handling defined in the Community Hub plan. Extend that shared format with a `theme` or `decorative-pack` kind.

Keep these records separate:

| Record | Responsibility |
|---|---|
| Package/version | Immutable styling, assets, capabilities, and digest. |
| Listing | Creator, description, previews, price, and publication state. |
| Entitlement | Account’s acquisition of an item. |
| Hub grant | Sponsoring entitlement, root hub, membership status, and expiration. |
| Theme binding | Applied item/version, target scope, and customization overrides. |
| Order and ledger | Payment history, deductions, refunds, and creator earnings. |

Marketplace APIs cover catalog browsing, creator submissions, acquisitions, checkout/order status, library access, grants, downloads, reports, and administrative actions.

Use Cloudflare Workers with a separate marketplace D1 database and private object storage. Authorize downloads and grant mutations server-side. Consume durable membership-change events from Community Hubs and reconcile missed events. Expiration checks remain effective even if a scheduled cleanup runs late.

**Commerce**

Implement a provider-neutral payment boundary, with Stripe Connect and hosted Checkout as the sandbox reference integration. Provider eligibility and cross-border payouts depend on the eventual operator and creator countries; production availability must be verified before activation. [Stripe marketplace documentation](https://docs.stripe.com/connect/marketplace), [payout availability](https://docs.stripe.com/connect/connect-cross-border-payouts).

- Open checkout and seller onboarding in the system browser. Stripe-hosted onboarding does not support desktop embedded webviews. [Hosted onboarding requirements](https://docs.stripe.com/connect/marketplace/tasks/onboard).
- Start with one item and one creator per order.
- Price orders on the server and snapshot their currency, terms, and commission.
- Grant ownership only after backend-confirmed payment success. Handle delayed payments, duplicate events, retries, and out-of-order delivery idempotently. Browser return pages never establish ownership. [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment).
- Maintain an append-only financial ledger using integer currency units. Reconcile processing costs, creator transfers, refunds, and disputes.
- Provide refund requests and administrative resolution, including transfer recovery and grant consequences. Final refund terms and payout timing are production-activation configuration.

Before real-money launch, establish the operator country/entity, supported countries and currencies, provider approval, tax handling, seller agreement, refund policy, and payout/reserve policy.

## 5. Delivery and acceptance

1. **Shared contract and local marketplace:** sample listings, accurate previews, library, decorative-pack installation, and simulated grants.
2. **Free marketplace:** authenticated creator enrollment, submissions, review, free claims, versioned distribution, reporting, and account library restoration.
3. **Live licensing:** hub sponsorship, five-slot enforcement, membership events, 24-hour expiration, rejoining, and fallback styling.
4. **Sandbox commerce:** hosted onboarding/checkout, paid orders, financial ledger, refunds, disputes, and seller statements.
5. **Production pilot:** activate verified payment regions and onboard a small initial seller cohort through the open enrollment flow; expand after operational validation.

Required acceptance scenarios include:

- Free claims never invoke checkout; incompatible items cannot be applied.
- Six simultaneous grant requests produce at most five occupied hub slots.
- Multiple Spaces/channels in one hub consume one slot per item.
- Leaving at time T expires the grant at T + 24 hours; rejoining beforehand cancels expiration.
- Membership removal starts grace; losing management authority alone does not.
- Grace-period grants occupy slots; immediate withdrawal releases them.
- Another valid sponsorship prevents unnecessary fallback.
- Refunds, duplicate webhooks, and retries never duplicate entitlements or payouts.
- Failed installs preserve the current design; expired styling preserves community content.
- Identity recovery restores the correct account library; foreign accounts cannot access private orders or mutate grants.
- Windows and Linux support preview, installation, external checkout, and return-to-app behavior.

Measure preview-to-acquisition conversion, successful application, creator publication time, slot/expiration failures, refunds, disputes, and payout reconciliation. Do not collect private hub conversations or member activity for marketplace recommendations.
