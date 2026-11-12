# Marketplace sandbox commerce

Source: `cloudflare/marketplace-commerce.js`; schema: `cloudflare/marketplace-migrations/0002_commerce.sql`. Apply marketplace migrations in order to the dedicated `MARKETPLACE_DB`, never the accounts database. Backend authentication supplies a stable account ID and its own administrator decision. Browser-supplied creator IDs, amounts, currency, ownership and return parameters have no authority.

This implementation is sandbox-only. It accepts `MARKETPLACE_COMMERCE_MODE=sandbox` and an `sk_test_` secret; live keys and live webhook/provider objects are refused. There is no production activation environment variable. No charges, onboarding sessions or transfers were created against Stripe during implementation: tests use a deterministic HTTP transport and real SQLite SQL.

## Contract

`handleCommerceRequest(request, env, {accountId, db, admin})` returns a `Response`, or `null` for routes it does not own. All paths below follow `/api/v1/marketplace`.

| Method/path | Input / authority | Result |
| --- | --- | --- |
| POST `/commerce/checkout` | Signed-in account; `{itemId,termsAccepted:true}` for paid items | `{orderId,url,mode:'sandbox',termsVersion}`; free items return `{free:true,owned:true}` without contacting Stripe |
| POST `/commerce/onboarding` | Signed-in creator | `{url,mode:'sandbox',verified}`; Stripe-hosted onboarding URL |
| GET `/commerce/orders` | Signed-in buyer | Up to 200 recent orders belonging to that buyer |
| GET `/commerce/statements` | Signed-in creator | Up to 200 orders and 1,000 ledger entries, with original currency, pending/settled amounts, deductions, transfers and recovery status |
| POST `/commerce/orders/:id/refund-request` | Buyer of the paid order; `{reason}` | Idempotent refund request |
| POST `/commerce/orders/:id/refund-resolve` | Backend-authorized administrator; `{decision:'approve'|'reject',reason?}` | Idempotent resolution; approval requests a full provider refund |
| POST `/commerce/orders/:id/transfer` | Backend-authorized administrator | Transfer only known, available, undisputed creator earnings to the verified connected account |
| POST `/webhooks/stripe` | No account JWT; valid Stripe HMAC signature required | Signed sandbox events trigger canonical provider reconciliation |

Open returned Checkout and Connect URLs in the external browser. Only HTTPS URLs on `checkout.stripe.com` or `connect.stripe.com` are accepted. Browser success/return/cancel pages never grant ownership; refresh server state after returning. Root-hub membership sponsorship uses its separate membership authority and is not created by purchasing an item.

## Provider boundary and configuration

`StripeSandboxProvider` isolates hosted checkout/onboarding, verified events, canonical payment reads, account verification, disputes, transfers, reversals and refunds. Payment reads normalize provider objects before commerce accounting. Adding another provider requires an implementation of these operations and reviewed event/amount/settlement mapping in source. A browser request or environment flag cannot install a provider or bypass event verification. `STRIPE_FETCH` is a server-owned HTTP transport seam used by tests; production defaults to `fetch` against the fixed `https://api.stripe.com/v1` origin, refuses redirects and pins `Stripe-Version: 2026-10-28.endive`.

Sandbox operator configuration:

- `MARKETPLACE_DB`: dedicated D1 binding; `MARKETPLACE_ASSETS` remains the backend asset binding.
- `MARKETPLACE_COMMERCE_MODE=sandbox`.
- `STRIPE_SECRET_KEY`: sandbox `sk_test_` key stored as a Worker secret.
- `STRIPE_WEBHOOK_SECRET`: endpoint `whsec_` signing secret stored as a Worker secret.
- `MARKETPLACE_RETURN_URL`: operator-configured HTTPS browser landing page, without credentials or fragments.
- The authenticated Worker, rather than commerce request JSON, decides which stable account IDs may moderate refunds and initiate transfers.

Use Stripe Accounts v1 Express hosted onboarding. Verification checks `charges_enabled`, `payouts_enabled`, `details_submitted`, the active transfer capability, and outstanding/disabled requirements. Paid checkout re-fetches provider readiness; backend paid publication also checks the stored verification result through `assertCreatorCanSell`. Returning from onboarding does not itself mark an account verified. Reopening onboarding refreshes verification and obtains a fresh account link.

Configure a **snapshot** webhook endpoint pinned to the same API version. Relevant event families are Checkout completion/async success, PaymentIntent success, charge success/update/refund, refund create/update, dispute events, and transfer create/update/reversed. Unsupported event types are acknowledged and ignored. A relevant event with an unknown order is retried, because success/refund/dispute deliveries may arrive out of order. Requests are streamed with 16 KiB JSON / 1 MiB webhook limits. Verification uses the raw UTF-8 body, HMAC-SHA256, Web Crypto verification, and a five-minute signature timestamp window.

## Ownership and accounting

An order contains one item and one creator, with immutable-by-application server snapshots of published version, title, integer price, lowercase currency and accepted terms version/time. A partial unique SQL index limits each buyer/item to one pending order. Retried Checkout calls reuse that order and its provider idempotency key; once its session ID is saved, retries retrieve that session rather than replaying session creation after provider idempotency retention. Expired sessions and uncertain session creation older than 20 hours stop for operator reconciliation; automatic replacement of expired orders is outside this sandbox implementation. A session already paid returns `awaiting_verified_webhook` without granting access. The browser cannot override snapshot pricing.

Entitlement creation, refunds/lost-dispute revocation, grant revocation, and accounting deltas are committed in one D1 batch. Paid entitlements reference their purchase order. A refund cannot revoke an unrelated free entitlement or a later repurchase. Any confirmed partial or full refund revokes that purchase's entitlement and all its sponsored grants immediately, including grants in grace. Reconciliation never regrants the refunded order. An open dispute freezes transfers while retaining access; the canonical provider result `won` releases the hold, while `lost` revokes access and requests transfer recovery. A previously confirmed loss remains terminal for that order.

`marketplace_ledger` records integer minor-unit deltas, with SQL triggers rejecting UPDATE and DELETE. Gross receipts, tax, refunds, processing costs, creator earnings, Vumiro earnings, creator transfers and transfer recovery have separate entry kinds. The ledger never combines currencies. Settlement conversion into a different currency fails closed for operator reconciliation.

The distributable amount is `max(0, gross - tax - refunds - known charge processing fee)`. Creator earnings are `floor(distributable * 85 / 100)`; Vumiro receives the remaining 15%, including the rounding remainder. A 1,000-unit sale with a 100-unit processing fee records 765 creator units and 135 Vumiro units. A subsequent 500-unit refund reduces creator earnings to 340 and Vumiro earnings to 60. No payout cost is deducted from creator earnings; Vumiro pays those costs. Initial payment fees are taken from the expanded provider balance transaction. Separate refund/dispute fees, fee rebates, foreign-exchange effects, tax corrections and bank payout fees require operator accounting before any live launch; this sandbox does not invent estimated fees or silently convert currencies. Checkout tax automation is deliberately disabled pending a tax policy, although verified provider tax amounts have a separate accounting column and regression coverage.

Provider delivery IDs are durable receipts, and ledger entries calculate deltas against current SQL totals inside the batch. Re-delivery, equivalent separate events and stale lower refund totals do not duplicate entitlements or earnings. Transfers and recoveries additionally persist exact operation parameters and idempotency keys before HTTP, with one unfinished money operation per order. A refund arriving after an uncertain transfer resumes that exact operation before recovering funds. Concurrent refund targets are processed as separate incremental recoveries. An unfinished money operation older than 20 hours stops for operator provider reconciliation before Stripe's idempotency retention may expire. Do not delete operation receipts or blindly replay old provider mutations.

Transfer eligibility, amount and HTTP payload are frozen in one guarded SQL statement after account verification; a refund winning that verification race prevents transfer creation. Every recovery first imports canonical provider `amount_reversed`, including external reversals whose webhook has not yet arrived. A persisted oversized operation is retired with its original payload/key preserved only when the canonical remaining amount and unreached target prove that operation could not already have succeeded; replacement uses a new key containing the updated baseline. Other uncertain concurrent provider mutations stop for operator reconciliation instead of rewriting an in-flight request.

Refund approval alone does not revoke access: a verified webhook confirming the provider refund does. If transfer recovery fails because funds are unavailable or the provider is unreachable, access revocation and deductions remain committed and event processing remains retryable. `recovery_required` is an actionable reconciliation state. Bank payout completion is **not** inferred from a Connect transfer: statements say `transferred_to_provider` and explain that distinction. External provider transfer reversals are fetched canonically and reflected once in recovery entries.

Aggregate acquisition/refund/dispute/reconciliation-failure metrics are best effort, deduplicated per order/transition and contain item IDs only. Metric failures never prevent payment processing.

## Verification and live-launch boundary

Run `node --test cloudflare/marketplace-commerce.test.js`. The suite uses `node:sqlite` and the actual migration with D1-shaped prepared statements and transaction batches. It covers server snapshots, free bypass, sandbox refusal, signatures/timestamps, duplicate/out-of-order events, real provider identifier shapes, tax/processing arithmetic, uppercase listing currencies, mixed-currency refusal, append-only ledger enforcement, partial/full refunds, refund/admin authority, open/won/lost disputes, parallel checkout, external transfer reversal, serialized incremental recovery, uncertain-transfer recovery and aggregate deduplication. Node 24 currently prints its experimental SQLite warning.

Production remains unavailable until a separately reviewed implementation and explicit release acceptance establish operator legal country/entity, supported buyer/creator/settlement currencies and regions, merchant/platform obligations, applicable tax handling, refund and chargeback policies, creator agreements, payout schedule/reserves/recovery policies, processor/Connect approval and verified real account capabilities. That implementation must reconcile complete refund/dispute/payout fees and bank payout outcomes, exercise provider sandbox webhook/Connect flows, run operational recovery tests and validate country/currency compatibility. Environment configuration alone cannot satisfy or bypass this boundary.

Official Stripe references verified during implementation (2026-11-11): [API versioning](https://docs.stripe.com/api/versioning), [Checkout creation](https://docs.stripe.com/api/checkout/sessions/create), [webhook signature/delivery behavior](https://docs.stripe.com/webhooks), [hosted onboarding](https://docs.stripe.com/connect/hosted-onboarding), [separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers), [transfer creation](https://docs.stripe.com/api/transfers/create), [transfer reversals](https://docs.stripe.com/api/transfer_reversals/create), and [dispute status/object](https://docs.stripe.com/api/disputes/object).
