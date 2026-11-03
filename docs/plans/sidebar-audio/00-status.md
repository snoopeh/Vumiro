# Sidebar, account actions and audio controls

Decision date: 2026-11-03. The user requested an industry comparison and implementation, with standing authority to make implementation decisions without approval gates. The software-factory design stages are recorded here under that delegated authority.

## Product

Keep Friends and Rooms easy to find. Move personal preferences and account actions into the bottom profile disclosure, with an explicit account sign-out action. Remove duplicate branding and the marketing block. Distinguish local profile/account state from connection availability. Keep an active call alive while navigating or signing out of account sync.

Provide Voice & audio before and during calls: microphone/speaker selection, a local input meter and microphone test, speaker test, supported speech-processing controls, master playback volume and deafen. Opening settings must not start recording. Tests must stop on close and isolate outgoing/incoming call audio while active. Retain per-person Screen and Voice volumes.

Acceptance: account sign-out is reachable from the profile menu; all new controls operate real media behavior, work by keyboard, and report unsupported browser features truthfully. No claim of complete Discord parity. Native global push-to-talk, hardware gain and music DSP are outside this increment.

## Research

- [Discord audio troubleshooting](https://support.discord.com/hc/en-us/articles/360045138471-Discord-Voice-and-Video-Troubleshooting-Guide): device/volume controls and distinct mute/deafen.
- [Discord microphone test](https://support.discord.com/hc/en-us/articles/360020641332-Mic-Testing): local loopback and test isolation.
- [Slack huddle preferences](https://slack.com/help/articles/1500002037922-Adjust-your-huddles-preferences): default devices, processing and input meter.
- [Zoom testing](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062765): microphone and speaker tests.

## Architecture and program design

No backend schema, account snapshot or provider changes. Hardware preferences stay local under a separate storage key. An isolated `VumiroAudioSettings` namespace in the existing `local-profile.js` asset avoids changing frozen Windows update manifests. The parent routes audio settings into the live same-origin call frame so tests can gate that call synchronously. The call adapter replaces microphone tracks transactionally, keeps prior capture on failure, composes master/per-person playback and gates mute/deafen/test independently. Native system-loopback audio remains separate.

Sidebar: `friends.html`, `friends-client.js`; account state and serialized logout: `account-client.js`; shared audio panel: `local-profile.js`; media integration: `call.html`, `call-client.js`; trusted Electron speaker permission: `Vumiro.Linux/main.cjs`. Existing allowlists remain frozen. The account API exposes no token or credential to sidebar callers.

## Slices and verification

- [x] Profile disclosure, account state and robust logout; account regressions.
- [x] Real device/preferences/test panel and active-call integration; capture teardown/routing/gating tests.
- [x] Browser visual and keyboard review, build/package validation, 1.21.8 publication.

Hardware device switching, acoustic echo quality and Linux desktop permissions require real platform acceptance; mock tests cannot establish them. Record actual verification separately.

## Verification before publication

73combinedbackend/client/identity/OAuth/sidebar/audio tests passed. Independent audio review caught and verified fixes for selected-output startup, tracks arriving during output changes, mute/deafen during input replacement, and ended-input rollback. Windows build and both frozen-manifest package checks passed with zero warnings/errors. Browser review confirmed menu grouping, local-mode state, Escape focus return, and opening audio settings without capture. Closing a pending microphone permission request restored focus; actual microphone permission/hardware acceptance was not established. Browser viewport override did not change the rendered1280×720viewport, so narrow positioning is covered by behavioral tests and code review, not claimed as a physical-window screenshot check.

Release1.21.7 already published and email registration enabled. This change is1.21.8; publication evidence follows afterCI.

## Interface release completed — 1.21.8

Source `0826933` is tagged [client-v1.21.8](https://github.com/snoopeh/Vumiro/releases/tag/client-v1.21.8). [Release CI 41575384805](https://github.com/snoopeh/Vumiro/actions/runs/41575384805) and [main CI 41575373132](https://github.com/snoopeh/Vumiro/actions/runs/41575373132) passed Windows and Linux. All seven expected assets have positive sizes and published SHA-256 digests.

The public Worker is now `ecf57d68-409b-492b-8321-764a83a512b8`; internal storage owner is `6cbc8f79-ee73-40fb-a895-5791abcb0364`. Original bindings are retained. All nine served web assets match committed source byte-for-byte. Live account service and registration remain enabled; social providers remain disabled.

The release adds compact navigation, the profile/account disclosure and explicit local account logout, Voice & audio device preferences/tests, supported speech processing, master playback and deafen. There are 73 passing automated regressions. Independent media review and Windows build/package checks passed. Browser review confirmed disclosure keyboard/focus behavior, audio entry without capture, pending-request closure and preference persistence. Physical audio-device/platform acceptance and installed-desktop two-device account acceptance remain outstanding; they are not inferred from mocks or package validation.
