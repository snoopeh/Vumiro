# Account and settings refinement — 1.21.9

The account flow now uses a compact sign-in layout with an aligned ribbon wordmark, locally embedded Outfit typography and the existing artwork. Email/password, Google/Microsoft, password recovery, encrypted identity unlock and local-only use remain available. Signup retains password confirmation, the actual 12-character minimum and privacy acknowledgement. Email verification follows account creation or an unconfirmed sign-in; it is no longer a separate login-page choice.

Returning sign-ins reuse valid current-version notice evidence from the account instead of prompting on every visit. Sign-in itself never manufactures acceptance of a missing or changed notice; account backup still checks that evidence. Signing out returns to the login page and retains the local profile.

Settings fills the app window and has navigation for profile, account, voice/audio, screen sharing, connection, blocked people and updates. Account actions are grouped into backup, security, devices, sessions and data. Native dialog focus/Escape and the existing titlebar controls remain available. In-call audio settings open the shared app settings through a checked same-origin parent.

Windows caption double-click uses OS timing and distance thresholds to maximize or restore, without competing DOM double-click handlers. A valid OAuth callback restores and focuses the app and asks the browser to close the callback tab. Browsers may refuse to close a tab opened by the operating system; the page then shows a brief return-to-app message. Invalid callbacks, provider denial and cancellation do not activate the app.

All layouts and fonts remain in the existing packaged HTML/JavaScript filenames, preserving older Windows updater allowlists. Font copyright and licensing are included in the shipped third-party notices.

## Verification

Final test, browser and publication evidence is recorded in [the account launch record](../.planning/ACCOUNT-LAUNCH.md). Browser visual tests use an isolated local fixture with disposable mock credentials and no real account mutations. Native unit/build/package checks are separate from installed-app hardware and cross-device acceptance.
