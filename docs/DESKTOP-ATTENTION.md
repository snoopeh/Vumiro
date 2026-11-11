# Desktop notifications and nudges

Windows notifications are separate native corner windows, including when Vumiro has focus. The shared notification controller sends only enabled visual events to the host. It keeps the notification inbox and resolves clicks against the current session; the native bridge accepts bounded display text, an optional local avatar image, and an opaque event ID, never a URL or executable action.

Each popup has the native window title `Vumiro notification`. It appears at the bottom-right of the app monitor's desktop work area, above the taskbar. At most three popups remain visible; ordinary popups close after seven seconds and call popups after twelve seconds, including while hovered. Showing a popup does not activate it or change the foreground window. Clicking its body deliberately brings Vumiro forward and asks the shared controller to open the still-valid item. The close button only dismisses it. Navigation, identity/session cleanup, and app shutdown dispose the popup center and prevent stale delivery.

A normal Windows nudge physically moves Vumiro for at most 900 milliseconds with a decreasing offset of at most twelve pixels. This includes Vumiro's own maximized window and content fullscreen. The effect keeps the native window state and restores the exact original geometry and normal restore bounds. User movement, resizing, hiding, and state changes cancel it without overwriting the user's new geometry. It never brings Vumiro forward.

The yellow monitor-edge cue is reserved for a different foreground process occupying a complete monitor. The detector reads the foreground window's process and rectangle, excludes desktop/taskbar shell windows and Vumiro's own process, and compares its rectangle with its monitor bounds. It does not capture another app's pixels. Vumiro does not shake in this case; the finite edge window is transparent, click-through, and nonactivating. Windows animation preferences, reduced-motion preferences, and silent nudges use a neutral frame without moving Vumiro. Popups and edge cues can appear over a borderless fullscreen app; an exclusive fullscreen game may prevent the Windows compositor from drawing them.

On Linux, desktop notifications use the system notification service, which controls their final appearance and placement. Supported X11 backends request native movement while preserving maximized/fullscreen state; a window manager may refuse those movements. Wayland does not expose the required position control, so the shared UI uses its neutral bounded fallback. Foreign-process fullscreen detection and monitor-edge cues are currently Windows-specific. Linux compositor behavior still requires Linux desktop QA.

Focused checks:

```powershell
dotnet run --project tests/NativeWindowChecks/NativeWindowChecks.csproj -c Release
dotnet run --project tests/NativeNotificationChecks/NativeNotificationChecks.csproj -c Release
node --test tests/nudge-effect.test.mjs tests/linux-nudge.test.mjs tests/native-notification-bridge.test.mjs
```

Run native checks sequentially because they create short-lived native windows. Physical-motion tests inject a stable foreground policy so another application being fullscreen during a check cannot change their result. The real LOCAL QA client remains the human acceptance surface.
