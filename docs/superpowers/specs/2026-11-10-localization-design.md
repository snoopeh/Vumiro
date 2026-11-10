# Language selection and localization

Date: 2026-11-10
Source: priority 2A, main-language support and default selection
Status: architecture ready; launch locale set needs product decision

## Goal and current state

People should be able to use the complete sign-in, lobby, room, settings, error, and recovery flows in a supported language. `auth.html`, `friends.html`, and `call.html` currently declare `lang=en`; most interface strings are English literals in HTML and JavaScript. A partial translation of one page must not be advertised as language support.

## Approaches considered

1. **Detect a sensible first-run default and always offer a manual selector (chosen).** Use the ordered `navigator.languages` list, matching exact supported locale and then base language; fall back to English. An explicit choice wins thereafter. This gives a low-friction default and a visible correction path.
2. Ask everyone to choose on the login screen before use. Unambiguous, but adds a setup step even when the device preference is correct.
3. Detect only, with no manual override. Simple, but wrong for shared devices, bilingual users, and mismatched browser/system preferences.

## Interaction and content

Put a compact language selector on the sign-in screen and in Settings. Display each language in its own name (for example, English and Português (Brasil)); changing it updates the current page immediately and persists a per-device preference. An unsupported or corrupt saved value falls back safely to English and keeps the selector usable. A first-run system match is a default, not a lock. Do not infer language from IP address, account email, or peer identity.

Translate all user-facing controls, dialogs, toasts, validation and error messages, placeholders, titles, accessibility labels, and native shell strings that the user encounters. Keep user-authored chat, profile text, friend nicknames, provider names, and protocol strings unchanged. Use `Intl.DateTimeFormat`, `Intl.NumberFormat`, and `Intl.PluralRules` or equivalent formatter APIs for timestamps, counts, sizes, and plural forms. Avoid string concatenation that assumes English word order. Update `<html lang>` on every page and mark isolated foreign-language phrases where needed. Start with left-to-right launch locales; a right-to-left locale requires an additional layout and directional-text pass before advertising support.

## Architecture

Create one versioned locale registry, keyed message catalogs, a locale resolver, and small DOM binding helpers shared by auth, friends, and room assets. English is the complete source catalog. Build or test tooling checks that every supported catalog has every required key and required placeholders, with intentional fallback logged in development. Dynamic messages use typed parameters rather than HTML interpolation. Catalog strings are data, never executable markup. Localized error UI maps stable internal error codes to messages; raw server English text should not become the only user-facing message.

The selected locale lives in local per-device settings and is broadcast to the embedded room frame through the existing same-origin channel; it does not change peer protocol or account snapshots. Language changes must not reset a draft message, disconnect a call, or change focus unexpectedly. Shared web assets serve Windows and Linux. If a catalog loader adds assets, include them in both installers and updater allowlists and make the first render deterministic rather than flashing English before translation.

## Acceptance and verification

- First run selects the best supported entry in `navigator.languages`, with exact then base-language matching, otherwise English. Explicit selection survives restart and overrides later OS preference changes.
- All three application surfaces and their active dialogs update to the chosen language; keyboard focus, typed drafts, room connection, and settings drafts remain intact.
- HTML `lang`, date/time/number/plural formatting, titles, and accessible names agree with the active locale. User-generated content remains untouched.
- Catalog parity and placeholder tests pass for every advertised locale. Human QA walks sign-in, account recovery, friend request, room, call, settings, error states, narrow layout, and screen reader pronunciation in each launch locale.
- Unsupported locale, missing catalog, and malformed saved preference degrade to complete English without a blank screen or partial untranslated controls.

## Pending product decision

Choose the advertised launch locales and regional variants. A pragmatic first set is **English, Brazilian Portuguese (`pt-BR`), and Spanish (`es`)**, but the product owner should confirm the audience and translation-review capacity. Do not claim a locale until its full catalog and human review pass.

## References

- [MDN `navigator.languages`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/languages): ordered user language preferences.
- [W3C guiding users to translated pages](https://www.w3.org/International/questions/qa-site-conneg.en.html): combine preference detection with visible language choices.
- [W3C WCAG language of page](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html): expose the page language programmatically.
- [W3C WCAG language of parts](https://www.w3.org/WAI/WCAG22/Understanding/language-of-parts): identify passages in another language.
- [MDN JavaScript internationalization](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Internationalization): locale-aware formatting.
