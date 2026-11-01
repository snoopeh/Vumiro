# Vumiro brand assets

The ribbon-V vector follows the user's supplied red/black Vumiro design reference. `vumiro.svg` is the source mark; `scripts/Build-Brand.ps1` builds the multi-size Windows icon compiled into the desktop executable. The inline application marks use the same wing geometry without the black icon tile.

`Sora-latin.woff2` is the unmodified Latin variable font (weights 400–700) provided by Google Fonts at https://fonts.google.com/specimen/Sora; copyright and SIL Open Font License 1.1 are in Sora-OFL.txt and the shipped THIRD-PARTY.md. `scripts/Embed-Brand.ps1` embeds it into both existing HTML assets so the app has no font CDN dependency or additional package files.

The font was retrieved 2026-11-01 from Google's Sora v17 distribution. Source repository/license: https://github.com/google/fonts/tree/main/ofl/sora.
