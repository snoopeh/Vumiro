# UI concept implementation — 2026-11-02

The user supplied a scenic red moon/mountains background, a login mockup, and a room mockup. Requested login close to the concept, with a cleaner call view adopting its organization and button styling. Existing user authorization covers autonomous implementation and Git/release work.

## Implemented

- `auth.html`: supplied background embedded unchanged as a PNG data URL, existing Vumiro ribbon/Sora font, left brand/headline/Watch–Talk–Hang out pills, warm translucent right card, red tabs/actions, refined provider buttons, icon inputs, functional password reveal, scrollable forms and separate local-profile continuation. No fake Remember me option or inactive Help button.
- `account-client.js`: auth-page password visibility and signup-confirmation layout; SVG account navigation icon. Existing authentication, privacy, recovery and persistent-session contracts retained. Hosted accounts remain disabled pending the provider setup described in ACCOUNT-OPERATIONS.md.
- `call.html`/`call-client.js`: clean warm-dark stage, access/person/direct badges, rounded stream tools with fullscreen icon, matching chat/people panel, larger grouped mic/share/quality/invite/leave dock, prominent red Share and restrained Leave. No scenic art in active calls. Volume, media and invite behavior retained.
- `friends.html`/`friends-client.js`: matching shell/buttons, Watch Together navigation, one room heading, grouped Browse/Reconnect/Settings toolbar. Sidebar/grid minimum sizing corrected so short windows cannot push the dock below the viewport. Local identities/settings preserved.

## Packaging constraints

Version1.21.5. Background embedded inside an existing HTML file deliberately: existing client updaters reject extra file names. Both manifests and22-file complete package remain unchanged. auth.html about2.43MB; complete Windows ZIP about2.35MB, below current update limits. Linux and Worker still prepare9shared assets.

## Review/build evidence

Visual renders inspected at1672x941,1160x800,940x640 and390x844, including signup and room. Ignored previews under `dist/concept-preview`. The initially clipped dock at minimum size was corrected by bounding the outer grid row and making navigation shrink/scroll. Local Windows package build at `dist/concept-1215` completes with0warnings/errors; JavaScript syntax and diff whitespace checks pass. No tests added or manually run for this visual-only request. Existing GitHub CI runs automatically on publication.

Running user's app was observedPID16036 at `Vumiro.Client/bin/Release/net48/Vumiro.exe`1.21.4. It was not closed or overwritten. Updated client is delivered through1.21.5 release/update flow. Do not overwrite while it is running a room.

## Publication

- Source commit **4b87d4a** pushed to origin/main; **client-v1.21.5** tagged and published with all7expected download/checksum assets.
- Main CI **41499935490** and publish CI **41500142172** completed successfully, both Windows and Linux. Existing automatic CI checks passed; no extra tests were added or manually run for this visual-only task.
- Both Workers deployed successfully. Storage owner version `1c73e5d7-726b-4a39-b002-ce8eb7f20efa`; public version `a438978f-1dbf-4900-8002-d66d4574d5d6`. Live auth.html returns200 with2,432,020bytes. Account config remains503, service/registration disabled as intended.
- Local preview Worker stopped; render browser contexts closed. User appPID16036 was left running on1.21.4, untouched. It can receive1.21.5 through **Updates → Check for updates → Update now**. Do not overwrite it while it is running a room.
- Release notes explain the visual refresh and the account-provider gate. Login preview opened in Codex; call/login screenshots remain under ignored `dist/concept-preview`.

Keep account service, registration and OAuth-provider gates disabled until the separate hosted-account setup is complete. This task changes appearance and navigation.
