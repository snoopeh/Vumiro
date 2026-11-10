# Notifications and preferences

Date: 2026-11-10
Source: priority 2A, incoming friend additions/invites, room invites, and calls
Status: design ready; human review and implementation pending

## Goal and current state

Make important social events noticeable and actionable without repeating alerts after a reconnect. Users should control which event classes produce visual alerts and sounds. Current code already plays friend-request, room, and call cues and asks the Windows host to flash the taskbar for some events. The host's `notify` action only flashes the taskbar three times when unfocused. Current settings offer a global app-sounds switch and volume, with no per-event controls or notification list.

## Approaches considered

1. **One event pipeline with per-category preferences and platform presentation adapters (chosen).** Validate once, deduplicate once, then render in-app and through a native adapter. It scales to Windows and Linux without placing transport rules in the UI.
2. Add a toast call at each existing event handler. Faster initially, but reconnect replay and settings will diverge between event types.
3. Introduce remote push notifications. This would notify while the app is closed, but needs cloud subscriptions, endpoint identity, delivery rules, and a new privacy model. It is outside the present online-app scope.

## Event and preference model

Use explicit event categories: **Friend requests** (including accepted additions), **Room invites and join requests**, **Incoming calls**, and **Room activity**. Keep room chat cues in the existing App sounds controls unless chat notification settings are deliberately added later. Each event gets a stable local dedupe key from validated request nonce, invitation nonce, or room ID plus live-state transition. A reconnect or replay of the same event must not issue a fresh alert. Only authenticated, currently valid, unblocked, nonexpired events can enter the pipeline.

Add a Notifications settings section with per-category **Visual alert** and **Sound** controls, a global volume control reused from App sounds, and **Save** / **Cancel** behavior consistent with other settings. Default friend requests, direct invites, and calls on; default passive room activity to in-app only to reduce noise. The user can mute visual presentation without losing an actionable pending request. Settings are per device; cross-device synchronization is a later explicit choice. A local QA preview exercises each category without sending a network event.

## User interaction

Show a small in-app notification list accessible from the main lobby. It summarizes recent validated events and exposes the existing Accept, Decline, or Open action where still valid. Pending friend requests remain backed by the existing request store; the list must derive their current state rather than creating a second authority. Calls show countdown and cannot be accepted after expiry. An expired room event becomes informational or disappears; it never launches an invalid room. All alert text is bounded and escaped. A visible status remains available even when sound is off.

When Vumiro is in the foreground, use an in-app toast/list entry; when minimized or unfocused, request a platform alert and taskbar attention according to the category preference. Native activation restores the app to the relevant lobby/request view without auto-accepting a call or joining a room. The OS is allowed to suppress presentation through Focus Assist or notification settings. Avoid duplicate OS and in-app banners for the same event.

## Architecture and platform boundary

Centralize event validation and deduplication in the friends client, after the existing signature, friend, block, and expiry checks. Keep presentation decisions in a small notification controller that reads one versioned preferences record; migrate existing app sound/volume values without resetting them. Send only an allowlisted category, dedupe ID, bounded title/body, and safe action token to the desktop host. Do not send arbitrary URLs, HTML, or executable instructions over the host bridge. Clear sensitive/actionable state on sign-out, account/identity change, or expiry; keep only a bounded number of recent local summaries and a short retention period.

Windows is a .NET Framework 4.8 unpackaged WinForms host. Microsoft's current Windows App SDK notification quickstart requires .NET 6 or later, so implementation must select and verify a compatible native API or a supported fallback instead of assuming that quickstart can be pasted in. Linux should use Electron's native Notification adapter when supported. Platform adapters own focus/activation and OS feature detection; the shared web UI owns content and preferences. If native presentation is unavailable, in-app list and taskbar attention continue to work, and the UI must state that OS alerts are unavailable on that device.

## Accessibility, privacy, and acceptance

- Every category respects its saved visual and sound settings, including after restart; Save applies and Cancel discards changes. Existing sound volume migrates intact.
- One validated incoming event creates at most one alert, even across reconnection or friend-request replay. Blocked, rejected, self, expired, and duplicate events create none.
- An incoming call remains actionable until expiry; clicking an OS alert restores Vumiro but requires an explicit Accept. Friend request and room actions also recheck current state before acting.
- Keyboard and screen-reader users can open the list and act on entries. Live announcements are concise and do not steal focus. Reduced-motion settings apply to visual effects. Text remains readable at narrow widths.
- QA covers foreground, background, minimized, Focus Assist, global sound off, each per-event mute, duplicate replay, expiring calls, removal/block, Windows and Linux. Native-API support must be verified on the app's actual build/runtime, not inferred from a newer framework sample.

## References

- [Microsoft Windows app notifications overview](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/): native notification concepts and activation.
- [Microsoft .NET app notification quickstart](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-dotnet): documents its .NET 6+ prerequisite.
- [Microsoft Focus Assist troubleshooting](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/notifications-not-show-action-notification-center): OS quiet settings can suppress delivery.
- [Electron Notification API](https://www.electronjs.org/docs/latest/api/notification): Linux native desktop presentation and support detection.
- [W3C status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html): announce changes without taking focus.
