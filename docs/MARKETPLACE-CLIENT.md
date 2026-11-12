# Marketplace client integration

`marketplace-model.js` owns account-scoped state and service contracts. `marketplace-client.js` owns a scoped DOM view. Both require the existing `VumiroCommunityThemes` engine; no parallel theme authoring, validator or installer is introduced.

## Entry points

Load `community-themes.js`, `marketplace-model.js`, `marketplace-client.js`, then the application's marketplace entry. Initialize once:

```js
const marketplace = VumiroMarketplace.init({
  mount,
  getAccount: () => VumiroAccount.getState(),
  request: (path, options) => authenticatedRequest(path, options),
  getTargets: () => communityAdapter.targets(),
  applyBinding: (target, binding) => communityAdapter.apply(target, binding),
  openExternal: url => VumiroMarketplaceExternal.openExternal(url),
  openThemeStudio: () => communityAdapter.openThemeStudio()
});
await marketplace.show();
marketplace.hide();
```

`init` returns `show`/`open`, `hide`/`close`, `refresh`, `openExternal`, `destroy`, and a read-only `mode`. Initializing again destroys the prior view's stylesheet and listeners. Hiding invalidates outstanding UI operations. Account state changes clear or rebuild the account store; in-flight application callbacks and sales statement responses check their original account generation before mutating view state. Asynchronous Theme Studio opener failures appear in marketplace feedback.

The required account identity is a stable backend `accountId`, with `signedIn: true`. Email and local profile identity are not account keys. Default mode is `local-demo` until `getState().marketplaceEnabled` is true; an explicit `mode` option overrides this. Demo and remote records are separate. Default account transport strips the marketplace prefix before calling `VumiroAccount.marketplaceRequest`; an injected transport receives the complete `/api/v1/marketplace/...` path and a structured `{method, body}` object.

## Targets and appearance

Targets have `{id, rootHubId, name, scope, member, canManage, slots, binding}`. `scope` is `hub`, `space`, `text`, or `voice`. `rootHubId` is canonical; descendants share one sponsorship slot. `member` permits an explicit license offer. `canManage` permits applying or undoing appearance. Both remain advisory in the browser; remote grants, downloads and writes require service authority checks. A remote view with no adapter exposes no managed targets.

The default local view exposes four explicitly simulated surfaces on one root hub. Its bindings are simulation state, without any live service effects. The shared manager stores installed package metadata under an account-specific key and persists raster assets through its normal adapter in an account-specific IndexedDB database.

The user flow is deliberately separate: preview, acquire, install, offer a license to a root hub, apply, and undo. All acquired items, free or paid, have five distinct root hub sponsorship slots across every version. A member may offer without management authority. Grace preserves existing sponsorship use until its deadline and cannot create new sponsorships. Local controls simulate these states only.

Themes use their normal tokens, components, CSS, assets and layouts. Decorative packages use the same validated format with `kind: "decorative-pack"`, empty `tokens` and `layouts`, and documented engine component slots. Required slots must be exposed by the destination. The engine merges a decorative pack after the inherited base theme so its base tokens and layout survive.

`applyBinding` must render the given binding using the shared engine. The callback must not change hub content or bypass role checks. It receives a built-in `baseline` binding with `fallback: true` when remote effective rights are absent or cannot be verified. `reconcileBindings(targets, applyBinding, manager)` checks every connected target on show, system-browser return/focus, and explicit refresh. Saved backend configuration remains separate from effective styling in `snapshot().configurations`, so expiry does not erase customization. Reactivation can restore the server-approved binding. Apply failures request backend undo and restore the previous local appearance; failed install never changes applied configuration.

## Preview and service contracts

Pre-acquisition preview calls authenticated `GET /versions/:id/preview`, requires `{previewOnly:true, package, licenseNotice}`, validates the package, and renders it directly with `resolve` / `applyToRoot`. Preview bytes never enter the installer or establish an entitlement. Preview permission does not permit installation, shared use or redistribution. Download separately calls `GET /versions/:id/download`, optionally with `?hubId=root&scopeId=node&scopeKind=text` (using the destination's actual scope kind) for an authorized member of an installed sponsored hub.

Catalog and library use `GET /catalog` and `GET /library`. A version's safe immutable `summary: {kind, engine, slots, scopes}` is authoritative over flattened fields, so decorative labels and compatibility filters work before a package is downloaded; unknown engine compatibility is excluded when the compatible-only filter is selected. Library `items` preserve delisted acquired metadata; `latest_version_id` permits authorized downloads without a public listing detail. `POST /items/:id/claim` is free-only. Remote application calls scoped `PUT /hubs/:root/theme` with `itemId`, `versionId`, `scopeId`, `scopeKind`; undo uses `POST /hubs/:root/theme/undo`. Binding reads and hub-authorized downloads include `scopeId` and `scopeKind` query parameters; undo and failed-apply rollback include both fields in their request bodies so text and voice channels retain their authority type. Sponsorship uses `POST /items/:id/grants` separately. `grants()` normalizes server `effective_status` and grace timestamps for Membership and My Library, which show each sponsored root hub and occupied item slots. `withdrawGrant(grantId, {targets, applyBinding, manager})` uses holder-authorized `DELETE /grants/:id`, refreshes the library and reconciles target styling; local withdrawal removes only that account's selected simulated root sponsorship. The saved appearance configuration survives withdrawal, while the released slot is immediately available.

Product details show the actual validated package's components, layouts, engine compatibility, included asset identifiers/types and creator license. Loading a remote verified preview also loads published version history; acquired delisted history can be restored from the authenticated library response.

Creator registration calls `POST /creators/enroll`. Existing exported `.vumirotheme` files are validated before listing creation and version submission. Ownership/licensed rights and redistribution declarations are required. `GET /creator/items` plus version details restore reviewer feedback. Rejected/delisted submissions offer appeals; product pages offer reports. Review authority stays in the backend administration API.

Hosted onboarding and checkout use `POST /commerce/onboarding` and `POST /commerce/checkout`; paid checkout requires an explicit license/terms checkbox and sends `termsAccepted:true`. Only the existing native system-browser bridge opens server-returned HTTPS URLs. No embedded navigation or window fallback exists. Returning refreshes server state without granting a license. Commerce is currently a provider sandbox, and production commerce remains disabled by the service. Root hub membership has no separate subscription checkout.

`GET /commerce/statements` supplies actual order figures. The UI shows gross, tax, processing, refunds, creator/Vumiro share, settlement and transfer/recovery states. Creator earnings are 85% of net after tax/refunds/processing; Vumiro receives 15% and covers operating and payout costs from its own share. A provider transfer does not confirm a bank payout.

## Verification and limits

Run `node --test tests/marketplace-model.test.mjs tests/marketplace-client.test.mjs`. Tests include a real authenticated backend/SQLite/shared-engine contract from preview through scoped apply and undo, alongside account separation, storage rollback, sponsorship, grace, decorative validation, delisting, creator feedback, checkout consent and unavailable-authority fallback. Node emits its standard experimental SQLite warning for that contract test.

Native visual/human QA remains necessary. Live target availability depends on the separate Community Hub adapter; absent that adapter, the app intentionally remains a useful local simulation. Backend deployment, real payment enablement, publication approval and human QA acceptance are outside these client files.
