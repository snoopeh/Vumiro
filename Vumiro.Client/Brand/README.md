# Vumiro brand assets

The Blade V artwork uses the user's approved vector with the continuous upper sweep. `vumiro-v.svg` is the transparent mark; `vumiro-logo.svg` is the full lockup with outlined lettering. `vumiro.svg` places that mark on the dark desktop icon tile. Keep the approved paths intact when producing variants.

`scripts/Embed-Brand.ps1` embeds the vectors as shared SVG symbols and refreshes favicons in the authentication, friends and room pages. The sign-in screen and sidebar use the full lockup; compact navigation, window captions and room headers use the V. SVGs are embedded so existing Windows updater manifests and Linux packaging need no new runtime files or network requests. Rerunning the script updates existing artwork instead of duplicating it.

`vumiro.png` is the 1024 px raster master rendered from `vumiro.svg`; the same artwork is downsampled to `Vumiro.Linux/resources/icon.png` at 512 px. `scripts/Build-Brand.ps1` creates the seven-size Windows ICO from the master, shared by the main executable and updater. When changing the desktop vector, rerender both PNGs before rebuilding the ICO.

The Windows client also embeds that ICO as `Vumiro.DesktopIcon`. Window and tray icons load this resource directly. On a normal installed launch, `DesktopBranding` saves the unchanged multiresolution ICO to `%LOCALAPPDATA%/Vumiro/Icons/vumiro-<sha256>.ico` and refreshes existing desktop, user Start-menu and taskbar shortcuts whose target is this exact executable and whose icon is the default or an earlier cached Vumiro icon. Changing artwork therefore changes the shell icon path even when an update replaces `Vumiro.exe` in place. It preserves shortcut targets, arguments, custom icons and other installations, and sends an item-change notification for each modified link. LOCAL QA never performs this migration. Old cached icons stay available for existing shell references. Windows may retain separate taskbar pin metadata; a pin that still displays old artwork can require the user's unpin/repin action.

`Sora-latin.woff2` is the unmodified Latin variable font (weights 400–700) provided by Google Fonts at https://fonts.google.com/specimen/Sora; copyright and SIL Open Font License 1.1 are in Sora-OFL.txt and the shipped THIRD-PARTY.md. `scripts/Embed-Brand.ps1` embeds it into both existing HTML assets so the app has no font CDN dependency or additional package files.

The font was retrieved 2026-11-01 from Google's Sora v17 distribution. Source repository/license: https://github.com/google/fonts/tree/main/ofl/sora.

`Outfit-latin.woff2` is the unmodified Latin variable Outfit font (weights 100–900) from Google Fonts v15, retrieved 2026-11-03. It is used for the authentication layout, wordmark and app headings. Its SIL Open Font License is in `Outfit-OFL.txt` and the shipped `THIRD-PARTY.md`. It is embedded in existing HTML files to preserve offline rendering and updater compatibility.
