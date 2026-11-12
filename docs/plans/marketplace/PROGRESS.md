# Marketplace implementation record

Approved scope: the supplied PLAN.md; user explicitly requested autonomous implementation and isolation from other agents.

Checkout: `Vumiro-Marketplace`, branch `codex/marketplace`, base `69a6efc`.

Isolation: the desktop native worktree tool is bound to the outer workspace repository, while Vumiro is a nested repository. Created the worktree with `git -C Vumiro worktree add ../Vumiro-Marketplace -b codex/marketplace 69a6efc`. Other checkouts remain untouched.

Implementation boundaries:
- Shared contract and installer: snapshot the Community Hub theme engine dependency, extend its optional package kind; keep it one validator/renderer/installer across imports and marketplace.
- Backend: separate Worker/D1/R2, reviewed versioned free distribution and server-authorized sponsorship.
- Commerce: provider-neutral sandbox adapter, hosted browser handoff, immutable orders and append-only accounting.
- Client: marketplace, library, preview/apply/undo and creator submission using exported packages.
- Integration: stable account transport, native browser handoff, Windows/Linux assets and verification.

Baseline: backend `npm test` 98/98; fresh focused chat client check passed (2026-11-11).

Ruling: production activation remains unavailable until the separate business-setup milestone from the supplied plan is satisfied. No deployment, real-money charges, account credentials or production changes are needed for this implementation.

Ruling: Community Hub is being implemented in another checkout and is not yet committed. This branch snapshots only its shared theme engine as a dependency, records its hash, and exposes adapter hooks for authoritative hub licensing integration. Do not overwrite or copy the other agent's unrelated uncommitted files during integration.

## Verification and completion

Source implementation and review remediation are complete within the delivery boundaries below. Automated checks establish source readiness only; human acceptance, deployed integration and a production pilot require their own evidence.

## Shared dependencies and integration decisions

- Theme engine initial source SHA-256 `D598EC4D6F91181CEA4E00BAA2122F44A11EE4777C805A0F34036123E21759B8` from the other Community Hub checkout. During integration the existing manager and renderer were refreshed to support its Studio draft-asset API. Marketplace changes are optional kind validation, decorative composition/asset namespacing, and Worker-compatible loading.
- Shared Studio source SHA-256 `785E8F34A63B727D3E3A9780D050127BFDB2172068FB26F344C2E15A2D4DDD40`. It is reused verbatim; the marketplace opener only supplies isolated account storage, a sample preview and an accessible dialog. Its twelve upstream behavior tests run here as marketplace-studio.test.mjs.
- Ruling: authenticated prospective buyers may fetch approved published preview packages for real-engine interactive rendering. Preview authorization creates no entitlement and cannot license installation or sponsorship. Styling bytes are visible to a client that renders them; their confidentiality is not a DRM promise. Free pricing also grants no redistribution rights.
- Ruling: return-to-app means the neutral hosted page tells the user to return to the desktop app, whose focus handler refreshes authoritative state. No custom URI protocol or local browser return query grants ownership.

## Review remediation

- Safety: freeze transfer eligibility, amounts and HTTP parameters atomically; reconcile canonical existing reversals before calculating remaining recovery. Four targeted SQL/provider regressions cover the reported races and old operation repair.
- Licensing: use source event timestamps for timely rejoins delivered late; distinguish expired cleanup from voluntary withdrawal. Historical restoration that would exceed five slots fails closed and does not advance the source cursor.
- Client: guard deferred seller statements before state mutation; send exact text/voice scope kinds throughout authorization, reads and undo; render base and decorative CSS together; permit authorized managers to install an explicitly offered item before first activation.

## Delivery boundaries

1. Local marketplace source, real shared-engine previews, account-scoped library and existing Theme Studio export: implemented.
2. Authenticated free distribution, immutable reviewable versions, reports/appeals and restored library: implemented in the separate Worker/D1/R2 service.
3. Licensing core and durable event-consumer contracts: implemented and tested. Deployment still requires the Community Hub service's stable-account authority/event-feed adapter. The marketplace fails closed when it is absent; this branch does not modify that agent's checkout.
4. Sandbox commerce source/provider boundary: implemented and tested with a provider simulator. Actual Stripe sandbox account onboarding, network fulfillment and operational reconciliation need configured test resources and end-to-end execution.
5. Production pilot: deliberately unavailable until operator/entity/countries/tax/refund/seller/payout policies and provider approval satisfy the separate business setup milestone.

Catalog and library currently have explicit response limits; pagination is a follow-up. Unreferenced private uploads may need an object-store janitor after an interrupted metadata write. These do not authorize access to other accounts or shared hubs.

- Architecture follow-through: My Library and Membership show effective grants, grace deadlines, occupied slots and holder withdrawal. A real authenticated SQL regression proves the sixth sponsorship succeeds after immediate withdrawal and a foreign account cannot withdraw it.
- Marketplace content is initially English inside its isolated panel; the main sidebar entry is translated across the existing six app locales. Full marketplace localization is follow-up work.

Final verification command: `node scripts/Check-Client.mjs --native --output dist/marketplace-full-checks`. Read its exact current receipt/report for results; no cache reuse is enabled. Worker bundling uses Wrangler `deploy --dry-run`, never a deployment. Native human QA uses this checkout's isolated LOCAL QA profile. No source is merged into another active agent branch.

## Verified handoff (2026-11-11)

- Full uncached check command passed: 864 client tests passed, zero failed, one opt-in WebView/CDP skip; 162 backend tests passed; fourteen native checks passed. Receipt: `dist/marketplace-full-checks/checks-report.json`, source fingerprint `0c26bcace5c62630d0201e9c8099f4e09947210a17b7bd9adb61bcf38c0ac14e`.
- Windows Debug client build succeeded with zero errors/warnings.
- Separate marketplace Worker and existing gateway Worker both bundled successfully through `wrangler deploy --dry-run`; no deployment occurred.
- Linux preparation emitted all 43 shared assets; packaging/trusted-route regressions passed. Native Linux runtime QA is still pending on a Linux host.
- This verification section is a documentation-only addition after the recorded test fingerprint. Implementation source was not changed after the passing run.
- Keep `codex/marketplace` and this checkout for review/integration; do not merge another agent's uncommitted work by copying whole directories. Full marketplace localization and bounded-list pagination remain follow-ups.

## Actual Windows LOCAL QA evidence

- Launched this checkout's actual native app with its separate profile; title verified as `Vumiro · LOCAL QA · 569ae2e`.
- Ran the optional real WebView button interaction test separately against that isolated host: 1/1 passed, no skip.
- Ran the marketplace production modules inside an ephemeral, explicitly local-demo fixture in that same native WebView2: three catalog listings rendered; product preview, acquire, install, sponsor, apply and undo all passed. This used an ephemeral fixture account and local adapters, with no real credentials, hub writes or charges. The fixture was removed afterward.
- Screenshots: `dist/marketplace-discover.png` and `dist/marketplace-product.png`; result: `dist/marketplace-native-qa-result.json`. Visual inspection confirmed readable layouts and real theme styling.
- Reopen the normal LOCAL QA app without the temporary debug endpoint for user review. Human acceptance, actual Linux runtime and configured Stripe/hub end-to-end acceptance remain pending.
