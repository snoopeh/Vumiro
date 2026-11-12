# Feature checks

Start with a focused check while editing:

```sh
node scripts/Check-Client.mjs --group chat
node scripts/Check-Client.mjs --group streaming --group friends
node scripts/Check-Client.mjs --changed-since HEAD --reuse
```

The default `node scripts/Check-Client.mjs` keeps the complete client/backend suite. `--group all` explicitly selects it. The LOCAL QA launcher retains its thirteen native checks; feature selection can narrow those checks for iteration. Check output records the selected groups and the reason for expansion. Successful automated checks mean ready for human QA, not accepted or released.

| Group | Scope | Backend | Native checks |
| --- | --- | --- | --- |
| `gaming` | Built-in gaming, signed friend sessions, virtual LAN, WebRTC game sharing and mapped/physical controller input | Yes | Services, controller, dependency, LAN and host |
| `accounts` | Account entry, authentication, identity recovery, account profile data | Yes | OAuth callbacks, local service isolation |
| `friends` | Directory, tags, invitations, notifications, nudges, sidebar | Yes | Notification payloads, window/nudge/resize |
| `chat` | Direct conversations, Community Hub, chat pane, scrolling, room messages, media, emoji | Yes | None |
| `streaming` | Call layout, audio preferences, standalone `stream-mosaic.js`, connection recovery | No | Audio recovery, window/nudge/resize |
| `profile` | Profile cards, crop, cover encoding and transfer | Yes | None |
| `native` | Windows host integration, updater, diagnostics, bridges | No | All thirteen |
| `linux` | Linux host, trusted asset routes, smoke driver | No | None |
| `release` | Versions, asset manifests, packaging, shipping, release verification | No | Updater |
| `tooling` | Check planning, receipts, reports, local launcher checks | No | None |

The explicit file lists and source ownership live in `scripts/feature-checks.json`; `scripts/lib/check-plan.mjs` expands them. A change in a known test selects its whole group. Features overlap deliberately: account/profile data spans accounts and profiles, and notifications span friends and native/Linux bridges. Leaf web source changes also include shared packaging, trusted-asset, and localization consumers.

The large `call-client.js`, `friends-client.js`, `local-profile.js`, `peer-profile.js`, shared HTML and settings/motion/i18n modules span features, so their changes select the full suite. Unknown paths, unclassified/new tests, scripts, workflow files and native/Linux host changes also select the full suite. Add source ownership only when the dependency boundary can be established. Documentation-only changes and an empty change list select no feature tests. `--skip-backend` remains an explicit backend opt-out.

`--changed-since REF` includes committed differences from REF, staged and unstaged edits, and untracked files; renames include both paths. Invalid repositories or references fail visibly. Full plans discover every top-level `tests/*.test.mjs` at runtime, including newly added tests.

`--reuse` can reuse successful version/syntax/client results only when their receipt matches the current inputs. Source, configuration, environment and runtime changes invalidate reuse; backend and native checks always run fresh. It does not replace human QA. Keep changes within their feature module where possible and avoid editing shared files for unrelated cleanup.

`tests/CoverEncodingChecks` is an additional Windows/WebView2 runtime check for visual cover QA. It opens a browser host and takes the repository root as its argument; run it deliberately when reviewing cover rendering. It is outside the thirteen default native checks.
