# Vumiro 1.16.1

Added a subtle native Windows frosted backdrop to the title bar, sidebar and friends window. Text, buttons, dialogs and stream video keep their normal opacity. Fullscreen streams retain their solid background.

The effect follows Windows transparency/high-contrast preferences and falls back to the solid dark theme when unavailable. Uses the [documented DWM system backdrop](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type) and transparent WebView background, without making the whole window translucent or changing pointer input.

Restore point: `restore/pre-window-backdrop-1.16.0`; offline bundle and the previous published package are in `../Restore Points/2026-11-01-pre-window-backdrop`.

Compilation and JavaScript syntax checks only; appearance and runtime feedback remain with the user.
