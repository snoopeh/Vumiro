# Community Theme Creator Kit

Themes are local, portable appearance packages. They contain no community IDs, membership, conversations, invitations, or permissions. Importing a theme does not publish it or upload artwork. Creation, import, editing and private local application need no marketplace account, enrollment or review. Marketplace publishing, shared community distribution and entitlements are separate from this contract.

## Start a theme

Node.js is the only creator-kit dependency. Commands work on Windows and Linux from this repository:

```sh
node scripts/theme-kit.mjs starter viking my-theme.vumirotheme
node scripts/theme-kit.mjs validate my-theme.vumirotheme
node scripts/theme-kit.mjs package theme-source.json ready.vumirotheme
```

Choose `baseline`, `viking`, or `cyberpunk` for the starter. Existing output files are never overwritten. The checked-in `themes/*.vumirotheme` packages mirror the shipped demonstrations. Change the package `id`, `name`, and `author` before creating your own work. Increment `version` when changing an installed package. Versions install alongside each other, so selecting the preceding version restores it immediately.

Theme Studio opens from the app entry or **Open full private editor** in Community Hub appearance controls; connected communities also offer **Edit my private view**. It offers a package/version picker, semantic tokens, component styles, system or embedded WOFF2 fonts, density, layouts, bounded motion, CSS, background artwork and fit/position/repeat controls, desktop/narrow preview, undo/redo, save/discard, duplication, import, and export. A token edit normally saves a scope override. Editing CSS, artwork, motion, or export metadata saves an independent creator package. The export-name/author/version fields identify this package; increase the version before replacing previously installed creator work.

The editor groups controls into Theme selection, Colors, Typography & layout, Components, Artwork, and Advanced & export disclosures. Theme selection and Colors start open. Open other sections as needed; Save, Undo, Redo, and Discard remain in the action row. Native disclosure summaries support keyboard operation. When the host supplies a private destination, **Apply locally** applies the current flattened validated package without submitting it for review. The app host uses `VumiroLocalAppearance.applyPackage`; personal avatar/card/effect kinds use `VumiroProfileCosmetics.applyLocal`; the scoped host applies only the selected local Space or private community view. Save and Apply locally are separate actions. The latter retains the editor draft and never publishes shared content.

## JSON format, schema 1 / engine 1

`.vumirotheme` is UTF-8 JSON, never a ZIP or other archive. Both the browser and CLI execute `VumiroCommunityThemes.validate` from `community-themes.js`.

```json
{
  "format": "vumirotheme",
  "schemaVersion": 1,
  "id": "oak-and-ember",
  "name": "Oak and Ember",
  "version": "1.0.0",
  "author": "Your name",
  "description": "An original warm community theme.",
  "license": "CC0-1.0",
  "compatibility": {"engine": 1},
  "tokens": {"surface": "#191b17", "text": "#f1ead8", "accent": "#dfb575"},
  "components": {
    "card": {"borderColor": "#827055", "borderWidth": "2px", "borderRadius": "6px"}
  },
  "layouts": {"home": ["banner", "compact", "split"], "room": ["standard", "compact"]},
  "css": "[data-community-slot=\"heading\"] {letter-spacing:1px}",
  "assets": [],
  "previews": [],
  "motion": "ember"
}
```

Required fields are `format`, `schemaVersion`, `id`, `name`, `version`, `author`, `compatibility`, `tokens`, `components`, `layouts`, `css`, `assets`, and `previews`. Description, license, and motion are optional. Unknown fields are rejected. IDs start with a lowercase letter and contain lowercase letters, numbers, and hyphens, up to 64 characters. Versions use `major.minor.patch`. Metadata is bounded plain text. Unknown schema or engine versions fail validation.

## Semantic tokens

| Tokens | Values |
| --- | --- |
| `surface`, `surfaceRaised`, `text`, `muted`, `accent`, `accentText`, `border`, `success`, `warning`, `danger` | Hex or numeric RGB/HSL colors |
| `fontBody`, `fontHeading` | System UI, Georgia, Consolas, Arial, Verdana, Tahoma, or Trebuchet MS followed by a generic family; generic families alone; or `font(asset-id)` referencing an embedded WOFF2 asset |
| `fontSize` | 12–24px |
| `spacing` | 4–24px |
| `radius` | 0–32px |
| `shadow` | `none` or 2–3 bounded numeric lengths followed by a hex color |
| `density` | `comfortable` or `compact` |

Use `"Segoe UI", sans-serif`, `Georgia, serif`, or `Consolas, monospace` as font examples. Use `font(my-font)` for an embedded `font/woff2` asset. Studio adds uploaded fonts to the Body font and Heading font choices; component `fontFamily` accepts the same reference. Remote fonts and CSS imports are rejected. Omitted tokens receive the Vumiro baseline. Runtime variables use kebab-case names such as `--community-surface-raised` and `--community-font-heading`.

## Component slots and CSS

| Slot | App-owned element |
| --- | --- |
| `surface` | Community appearance root |
| `card` | Home sections, Space cards, information panels |
| `button` | Actions and interactive buttons |
| `input` | Search and message fields |
| `navigation` | Persistent community navigation |
| `call-controls` | Voice joining and leaving controls |
| `heading` | Page and section headings |
| `message` | Message rows |
| `banner` | Home identity artwork panel |
| `badge` | Status and local-preview indicators |

`components` uses camel-case property names. Allowed properties are `color`, `backgroundColor`, `backgroundImage`, `backgroundSize`, `backgroundPosition`, `backgroundRepeat`, `backgroundBlendMode`, `borderColor`, `borderWidth`, `borderStyle`, `borderRadius`, `boxShadow`, `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `lineHeight`, `textAlign`, `textTransform`, `letterSpacing`, `padding`, and `gap`. Values are validated per property: no arbitrary expressions, external URLs, custom variables, or resource fetches. Component font sizes are 12–36px, line height is `normal` or a unitless value from 1 to 2, spacing is at most 32px, borders at most 4px, and shadows at most 48px per length. Background fit accepts `cover`, `contain`, or `auto`; placement uses the documented center/edge/corner presets, and repeat accepts `no-repeat`, `repeat`, `repeat-x`, or `repeat-y`. Blend modes are `normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `soft-light`, and `hard-light`.

Advanced `css` uses ordinary CSS property names and exactly one documented slot selector per rule:

```css
[data-community-slot="card"] {
  border-color: #827055;
  background-image: linear-gradient(135deg, #292b20, #1d211b);
}
[data-community-slot="button"]:focus-visible {
  border-color: #dfb575;
}
```

The optional pseudo-classes are `:hover`, `:focus-visible`, and `:disabled`. Rules are scoped to an app-owned root; global selectors, combinators, at-rules, comments, escapes, custom properties, and `!important` are rejected. Geometry, positioning, transforms, visibility, pointer events, arbitrary animation, opacity, and control replacement are unavailable. App-owned focus indicators and essential navigation/call behavior remain enforced. Native controls and their semantics remain owned by Vumiro.

Button slots use the app-owned `data-variant="primary|secondary|quiet|danger"` attribute. Missing or unknown variants receive neutral secondary styling. Primary actions use the accent; secondary actions use a neutral surface; quiet actions use a transparent surface; danger actions use the danger token. Packages can decorate control shape and typography, but button color, background artwork, and shadows are reapplied after package CSS to preserve this hierarchy. Selected controls (`aria-selected="true"`, `aria-current="page"`, or `data-selected="true"`) retain a visible inset indicator as well as selected colors. These rules cover both the appearance root and its descendants without changing control geometry. Variant/state selectors are app-owned and cannot appear in portable package CSS.

Artwork can use `asset(texture-id)` in `backgroundImage` or `background-image`. Local CSS gradients accept two to five hex-color stops with optional percentages and a bounded angle. `motion` selects `none`, `ember`, `scan`, `orbit`, `shimmer`, or `pulse`; the app supplies bounded motion instead of package keyframes. Reduced motion disables them, and simplified styling clears decoration.

## Assets, previews, and limits

An asset is `{ "id": "texture-id", "mime": "image/png", "data": "BASE64_BYTES" }`. PNG, JPEG, WebP, GIF, and WOFF2 (`mime: "font/woff2"`) are accepted, with MIME, signature, base64 and size checks. Image references require raster assets; `font(asset-id)` requires a WOFF2 asset. SVG, HTML, scripts, arbitrary paths, remote resources, and archive entries are rejected. Asset IDs follow the package ID rules and must be unique. References must exist. `previews` contains up to four raster asset IDs; it cannot reference fonts or external images.

Limits are 2 MiB per JSON package, 16 assets, 512 KiB per decoded image or font asset, and 16,000 CSS characters. Studio checks file size before reading; the CLI checks the input file before parsing. Browser metadata stores asset IDs/MIME only, and IndexedDB stores image/font bytes separately. Runtime image/font Blob URLs are revoked when themes change or previews close, with data URI fallback when Blob URLs are unavailable. Font faces use generated names within each application root, and their stylesheet is removed with that root's cleanup. Missing artwork prevents export, while an unrelated broken package cannot stop another theme from previewing.

## Bindings, inheritance, and accessibility

Packages and bindings are separate:

```js
const binding = {
  mode: 'package',
  packageId: 'oak-and-ember',
  version: '1.0.0',
  overrides: {
    tokens: {accent: '#f0ca79'},
    components: {card: {borderRadius: '8px'}},
    layout: {home: 'banner', room: 'standard'}
  }
};
```

`{mode:'inherit'}` retains the parent appearance and may add scope overrides. Walk hub → folders/Spaces → channel. Selecting a package resets the visual baseline before applying that package, so an adjacent Space cannot inherit unrelated frames or typography. Scope overrides apply next. Personal `reducedMotion`, `simplified`, `highContrast`, and `fontScale` preferences apply last. Package and override validation use the same visual property rules.

Home placements are `compact`, `banner`, and `split`. Rooms support `standard` and `compact`. Layouts are presets; themes cannot replace app controls with HTML.

## Shared browser interface

```js
const Themes = window.VumiroCommunityThemes;
const manager = Themes.createManager();
const result = Themes.validate(jsonText); // {valid, errors, package}
await manager.install(result.package);
const versions = await manager.list(); // metadata, excluding built-in themes
const appearance = await manager.preview(binding, {bindings: ancestors, preferences});
const cleanup = Themes.applyToRoot(communityRoot, appearance);
const appliedBinding = await manager.apply(binding, {target: {kind: 'space', id: 'local-id'}});
const portableJson = await manager.export(binding.packageId, binding.version);
await manager.uninstall(binding.packageId, binding.version);
cleanup();
```

`Themes.resolve({bindings, packages, preferences})` is a pure resolver. `Themes.builtins` contains baseline, Viking, Cyberpunk, Aurora, Paper, Midnight and Rose packages; the first three also have checked-in CLI starter files. `manager.get(id, version)` loads a full installed package. IndexedDB is the browser asset adapter; `Themes.createMemoryAdapter()` supports tests and deliberate session-only operation. Supply `metadataStorage` and `storageKey` when isolating indexes. Invalid or denied metadata storage falls back visibly to a session index while preserving the original stored data. Quota/write failures do not publish a partial installation. A version is immutable once installed; use a new version to update it. Uninstall removes that version and its assets; bindings still pointing at it safely fall back to baseline.

```js
const studio = window.VumiroCommunityStudio.create({
  mount, previewRoot, manager, binding,
  bindings: ancestors,
  preferences,
  draftKey: `community-studio:${identityId}:${nodeId}`,
  contextLabel: 'Oak hall', // Optional name of the scope persisted by onSave.
  onSave: async nextBinding => saveScopeAppearance(nextBinding),
  onApplyLocal: async pkg => applyPrivatePackageToScope(pkg)
});
await studio.ready;
```

`onSave` must throw or return `false` if scope persistence fails. A failed save retains the draft. `contextLabel` names the destination in the editor and successful save feedback (for example, “Appearance saved in Oak hall.”). Omit it for local-only persistence, which reports “Appearance saved locally.” Package storage notices remain separate from scope save feedback. The label does not change persistence or authorize sharing; `onSave` owns that behavior. `draftKey` must include identity and target scope; omit it for an in-memory draft. The returned API includes `getDraft`, `dirty`, `setToken`, `setComponent`, `setBackground`, `setLayout`, `setCss`, `undo`, `redo`, `save`, `applyLocal`, `discard`, `duplicate`, `reset`, `importPackage`, `exportPackage`, `addAsset`, `addFont`, `addBackground`, `createKind`, `setViewport`, and `destroy`. Call `destroy` before leaving the editor. Theme Studio does not publish to a marketplace.

## Reviewed sharing in live communities

Private packages and private view overlays are not community publications. The local app, hub/Space editor and connected community's private editor can apply unreviewed packages on this device. Publishing that custom appearance to other members requires marketplace review. Builtins, inheritance and bounded validated scope overrides remain available without submitting a new package.

Shared mutations and local-hub publication accept a custom package only through an exact reference:

```js
const binding = {
  mode: 'package',
  packageId: 'oak-and-ember',
  version: '1.0.0',
  marketplace: {itemId: 'EXACT_ITEM_ID', versionId: 'EXACT_REVIEWED_VERSION_ID'},
  overrides: {}
};
await live.mutate([{type: 'theme', id: scopeId, binding}], revision);
```

The CommunityHub service resolves that exact item/version through the marketplace's internal `community-package` endpoint. It requires an approved version of a published, free theme or decorative listing, validates immutable package bytes/digest, and stores canonical reference metadata. A client-supplied digest or approval flag has no authority. Paid shared packages require the separate service-authorized licensing integration; the free resolver does not grant paid use.

For readers, `await live.themePackage(scopeId)` calls signed `POST /api/community/:hub/theme-package` with `{scopeId}`. The service derives the reference from stored configuration, resolves current review state and bytes, and rechecks membership, scope access and unchanged configuration after asynchronous work. The client validates the package, exact identifiers and digest before painting it. Missing or rejected review infrastructure cannot authorize a private package. Raw `sharedPackage` manifests and generic signed `asset-upload`/`asset-read` appearance paths are no longer a supported publication mechanism.

The CommunityHub Durable Object owner (`wrangler.storage.jsonc`) requires `MARKETPLACE_SERVICE` bound to the marketplace worker and the same `MARKETPLACE_INTERNAL_SECRET` of at least 32 characters on both services. These are provisioning requirements; source implementation does not deploy services or configure secrets. See [the marketplace API contract](MARKETPLACE-API.md#reviewed-packages-in-shared-community-hubs) for the complete boundary.

Portable exports contain no community IDs, review references or R2 object identifiers. Local packages remain in the signing identity's private library. Shared resolved bytes and previews are cleared on disconnect/identity change; private overlays for a connected community remain device-local and are stored separately from its authoritative bindings. Publishing a hub with unreviewed private bindings displays a submission instruction instead of silently discarding the requested design.

## Verification

```sh
node --test tests/community-themes.test.mjs tests/community-studio.test.mjs tests/community-theme-sharing.test.mjs tests/local-appearance.test.mjs tests/marketplace-studio-entry.test.mjs tests/profile-cosmetics.test.mjs
node scripts/theme-kit.mjs validate themes/baseline.vumirotheme
node scripts/theme-kit.mjs validate themes/viking.vumirotheme
node scripts/theme-kit.mjs validate themes/cyberpunk.vumirotheme
```

Test the resulting work in the LOCAL QA app at desktop and narrow widths. Check readable text, keyboard focus, navigation, call controls, light/dark artwork, reduced motion, and personal simplified styling. Automated package validation does not replace this visual acceptance.
