# Priority through 2A: implementation and review status

Date: 2026-11-10
Branch: `codex/priority-through-2a`
Gate: source review and human QA; no release or deployment authorization

| Backlog area | Current status | Review still needed |
| --- | --- | --- |
| 1A polish | Source complete, including nickname click-to-copy. Sign-in caption controls are explicitly anchored; the LOCAL QA badge insertion bug is fixed. | Confirm the controls at the upper right in the native sign-in window at normal, maximized, and wide sizes. The exact cause of the original installed-window screenshot is still unconfirmed. |
| 1B existing flows | Source implemented before this branch. | Human walkthrough of settings Save/Cancel, social search, mute display, call controls, chat formatting, sounds, and motion. |
| 1C reliability | Stream recovery, unique tags, cover editing, full-screen backgrounds, and mosaic were already source implemented. Updater helper recovery is now committed. | App-only audio selection remains unimplemented. Test updater recovery against disposable installed packages and exercise stream recovery/mosaic in a real call. |
| 2A direct invites | Source implemented before this branch. New invites encode intent in their signed nonce, preserving old-service and old-client compatibility. | Cross-version room invitation and call walkthrough. |
| 2A replies | Merged from `codex/room-replies` with focused tests passing. | Real room drag, keyboard, mixed-version, and reconnect walkthrough. |
| 2A shared items | Full design recorded; source not implemented. | Decide whether the requested history is session-only, persistent on device, or synced. |
| 2A languages | Full design recorded; source not implemented. | Confirm launch locales and arrange human translation review before claiming support. |
| 2A notifications | Source implemented: four event categories, saved visual/sound preferences, a bounded session inbox, signed invite intent, and stale-action checks. | Foreground/background, reconnect, expiration, accessibility, and platform visual QA. Windows currently flashes the taskbar; Windows Notification Center popups need a product decision. |
| 2A Support me | Full design recorded; source not implemented. | Provide and verify the donation destination and recipient wording. |

## Verification on this branch

- Client JavaScript: 358 of 358 tests passed; syntax passed for 88 files.
- Updater focused checks: 34 passed; Windows client Release build passed with zero warnings and errors.
- The LOCAL QA launcher completed its client and native checks, and opened `Vumiro · LOCAL QA · 89b7b1a` from this checkout with an isolated profile. `dist/local-qa/launch.json` records the source, web root, process, and data root.
- Native WebView geometry after the LOCAL QA badge fix put the sign-in controls at the right edge of a 2560 CSS-pixel viewport. The browser fixture also placed them at the right edge. This does not verify the user's installed release window.

## Product decisions waiting for guidance

1. Separate Windows app-audio picker versus a unified native video/audio picker, and how unsupported platforms should present video-only sharing.
2. Launch locale set and regional variants.
3. Shared-item retention: current session, persistent per device, or synced.
4. Verified donation provider URL, recipient, and public wording.
5. Whether Windows taskbar attention plus the in-app inbox is sufficient for 2A, or Notification Center popups are required before signoff.

Do not mark this backlog section accepted until the missing scopes and human QA are resolved. Preserve the release gate in `AGENTS.md`: no version bump, push, tag, production deployment, or release before explicit human acceptance and a request to ship.
