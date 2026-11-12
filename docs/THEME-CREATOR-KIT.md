# Community Theme Creator Kit

Themes are local, portable appearance packages. They contain no community IDs, membership, conversations, invitations, or permissions. Importing a theme does not publish it or upload artwork. Marketplace publishing and entitlements are separate from this contract.

## Start a theme

Node.js is the only creator-kit dependency. Commands work on Windows and Linux from this repository:

```sh
node scripts/theme-kit.mjs starter viking my-theme.vumirotheme
node scripts/theme-kit.mjs validate my-theme.vumirotheme
node scripts/theme-kit.mjs package theme-source.json ready.vumirotheme
```

Choose `baseline`, `viking`, or `cyberpunk` for the starter. Existing output files are never overwritten. The checked-in `themes/*.vumirotheme` packages mirror the shipped demonstrations. Change the package `id`, `name`, and `author` before creating your own work. Increment `version` when changing an installed package. Versions install alongside each other, so selecting the preceding version restores it immediately.

Theme Studio opens from Community Hub appearance controls. It offers a package/version picker, semantic tokens, component styles, fonts, density, layouts, bounded motion, CSS, artwork, desktop/narrow preview, undo/redo, save/discard, duplication, import, and export. A token edit normally saves a scope override. Editing CSS, artwork, motion, or export metadata saves an independent creator package. The export-name/author/version fields identify this package; increase the version before replacing previously installed creator work.

The editor groups controls into Theme selection, Colors, Typography & layout, Components, Artwork, and Advanced & export disclosures. Theme selection and Colors start open. Open other sections as needed; Save, Undo, Redo, and Discard remain in the action row. Native disclosure summaries support keyboard operation.

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
| `fontBody`, `fontHeading` | System UI, Georgia, Consolas, Arial, Verdana, Tahoma, or Trebuchet MS followed by a generic family; generic families are supported alone |
| `fontSize` | 12–24px |
| `spacing` | 4–24px |
| `radius` | 0–32px |
| `shadow` | `none` or 2–3 bounded numeric lengths followed by a hex color |
| `density` | `comfortable` or `compact` |

Use `"Segoe UI", sans-serif`, `Georgia, serif`, or `Consolas, monospace` as font examples. Fonts are local; font files and remote imports are not supported. Omitted tokens receive the Vumiro baseline. Runtime variables use kebab-case names such as `--community-surface-raised` and `--community-font-heading`.

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

`components` uses camel-case property names. Allowed properties are `color`, `backgroundColor`, `backgroundImage`, `borderColor`, `borderWidth`, `borderStyle`, `borderRadius`, `boxShadow`, `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `padding`, and `gap`. Values are validated per property: no arbitrary expressions, external URLs, custom variables, or resource fetches. Font sizes are at least 12px, spacing is at most 32px, borders at most 4px, and shadows at most 48px per length.

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

Artwork can use `asset(texture-id)` in `backgroundImage` or `background-image`. Local CSS gradients accept two to five hex-color stops with optional percentages and a bounded angle. `motion` selects only `none`, `ember`, or `scan`; the app supplies slow border-color effects. Reduced motion disables them, and simplified styling clears decoration.

## Assets, previews, and limits

An asset is `{ "id": "texture-id", "mime": "image/png", "data": "BASE64_BYTES" }`. PNG, JPEG, WebP, and GIF are accepted, with signature checks. SVG, HTML, scripts, arbitrary paths, remote resources, and archive entries are rejected. Asset IDs follow the package ID rules and must be unique. References must exist. `previews` contains up to four asset IDs; it cannot reference external images.

Limits are 2 MiB per JSON package, 16 assets, 512 KiB per raster asset, and 16,000 CSS characters. Studio checks file size before reading; the CLI checks the input file before parsing. Browser metadata stores asset IDs/MIME only, and IndexedDB stores raster bytes separately. Runtime Blob URLs are revoked when themes change or previews close, with data URI fallback when Blob URLs are unavailable. Missing artwork prevents export, while an unrelated broken package cannot stop another theme from previewing.

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

`Themes.resolve({bindings, packages, preferences})` is a pure resolver. `Themes.builtins` contains baseline, Viking, and Cyberpunk packages. `manager.get(id, version)` loads a full installed package. IndexedDB is the browser asset adapter; `Themes.createMemoryAdapter()` supports tests and deliberate session-only operation. Supply `metadataStorage` and `storageKey` when isolating indexes. Invalid or denied metadata storage falls back visibly to a session index while preserving the original stored data. Quota/write failures do not publish a partial installation. A version is immutable once installed; use a new version to update it. Uninstall removes that version and its assets; bindings still pointing at it safely fall back to baseline.

```js
const studio = window.VumiroCommunityStudio.create({
  mount, previewRoot, manager, binding,
  bindings: ancestors,
  preferences,
  draftKey: `community-studio:${identityId}:${nodeId}`,
  contextLabel: 'Oak hall', // Optional name of the scope persisted by onSave.
  onSave: async nextBinding => saveScopeAppearance(nextBinding)
});
await studio.ready;
```

`onSave` must throw or return `false` if scope persistence fails. A failed save retains the draft. `contextLabel` names the destination in the editor and successful save feedback (for example, “Appearance saved in Oak hall.”). Omit it for local-only persistence, which reports “Appearance saved locally.” Package storage notices remain separate from scope save feedback. The label does not change persistence or authorize sharing; `onSave` owns that behavior. `draftKey` must include identity and target scope; omit it for an in-memory draft. The returned API includes `getDraft`, `dirty`, `setToken`, `setComponent`, `setLayout`, `setCss`, `undo`, `redo`, `save`, `discard`, `duplicate`, `reset`, `importPackage`, `exportPackage`, `addAsset`, `setViewport`, and `destroy`. Call `destroy` before leaving the editor. Theme Studio does not publish to a marketplace.

## Authenticated sharing in live communities

`community-theme-sharing.js` distributes a selected custom package through the connected community service. Uploads require theme permission on the target scope; reads use the service's current membership and ancestor access checks. Importing, previewing, or saving a local theme does not upload it. A live theme save or explicit community publishing action must call the sharing adapter before writing its binding:

```js
const publishing = window.VumiroCommunityThemeSharing.create({manager, live});
const sharedBinding = await publishing.publishBinding(scopeId, binding);
await live.mutate([{type: 'theme', id: scopeId, binding: sharedBinding}], revision);

// After an authorized snapshot, before applying its custom themes:
const receiving = window.VumiroCommunityThemeSharing.create({manager: sharedSessionManager, live});
const packages = await receiving.hydrate(snapshot.nodes.map(node => node.themeBinding));
// Verify the current identity/connection generation still matches before rendering.
```

`publishBinding` returns a binding with this service-only extension for custom packages:

```js
sharedPackage: {
  manifest: { /* normal package fields, assets: [{id, mime}], no base64 bytes */ },
  assets: [{id: 'texture-id', assetId: 'SHA256_BASE64URL_HASH_WITH_43_CHARACTERS'}]
}
```

Inherited and built-in themes require no asset uploads. Shared artwork supports PNG, JPEG, and WebP. GIF remains valid for local themes and portable exports; sharing rejects it explicitly because the community asset service does not accept that format. Font files remain outside the theme package contract even if the service can store them.

`hydrate` returns full validated `ThemePackage[]` and installs their immutable versions through the existing manager. It validates all manifests and mappings before any download, rejects URL/path references, and reads assets only with `live.assetRead(assetId)`. MIME, size, SHA-256 hash, raster signature, and reconstructed package limits are checked before installation. Missing assets, revoked access, incompatible schemas, unsafe CSS, and conflicting installed versions reject the operation. Callers must display the error and withhold the unresolved custom theme.

Each hydration reauthorizes asset reads even when an installed copy exists. Duplicate bindings within one call share a download. Use the normal connection/identity generation checks around the awaited operation; the live transport also rejects responses from obsolete connections. Portable exports contain no `sharedPackage`, R2 object IDs, or community scope IDs. Marketplace entitlement and distribution flows remain separate.

Use an identity- and connection-isolated in-memory manager for receiving shared packages and the live Studio. Supply both a memory asset adapter and an in-memory metadata storage implementation; the asset adapter alone does not disable the manager's normal localStorage metadata default. Clear shared packages, previews, and Studio state on disconnect, identity switch, or revocation. Shared private artwork must not enter another identity's personal installed library. Personal imports use their own identity-scoped metadata and IndexedDB namespace.

## Verification

```sh
node --test tests/community-themes.test.mjs tests/community-studio.test.mjs tests/community-theme-sharing.test.mjs
node scripts/theme-kit.mjs validate themes/baseline.vumirotheme
node scripts/theme-kit.mjs validate themes/viking.vumirotheme
node scripts/theme-kit.mjs validate themes/cyberpunk.vumirotheme
```

Test the resulting work in the LOCAL QA app at desktop and narrow widths. Check readable text, keyboard focus, navigation, call controls, light/dark artwork, reduced motion, and personal simplified styling. Automated package validation does not replace this visual acceptance.
