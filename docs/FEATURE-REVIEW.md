# App feature review — 2026-11-03

The requested pass focuses on dependable everyday account, navigation and audio behavior. This is a focused comparison with published product behavior, not a claim that Vumiro matches every feature in a mature communications app.

| Area | Finding and action |
| --- | --- |
| Accounts | Production verified-email authentication and recovery are connected; hosted enrollment, refresh, restore, revocation, export and deletion passed. Keep social providers visibly disabled until real provider setup and desktop round trips pass. |
| Sign-out | Account sign-out belongs in the persistent profile disclosure. Ordinary sign-out stops sync and clears the saved session while retaining the local profile and ongoing room. Keep all-device sign-out and device revocation explicit security actions in Account & backup. |
| Navigation | Remove the duplicate brand/tagline and marketing copy. Keep Friends, Rooms and the active Watch Together destination prominent. Group profile, account, audio, preferences and updates at the bottom. Distinguish account/local mode from signaling connection status. |
| Voice | Provide one Voice & audio panel with actual device routing, supported processing preferences, microphone/speaker tests, playback volume and deafen. Require an explicit action before microphone capture. Keep hardware preferences local to each device. |
| Per-person playback | Preserve separate Screen and Voice volume sliders; compose these with the master playback level and deafen. A new global slider must not erase individual adjustments. |
| Keyboard/accessibility | Profile disclosure needs Escape, outside click and focus return. Inputs need associated labels, device state/error text, visible focus and usable narrow-window layout. Test interactions, not only rendered text. |
| Updates | Preserve both existing Windows ZIP manifests. New updater allowlists cannot fix installed clients that reject unexpected files before upgrading. Keep Linux packages and checksums published alongside Windows. |
| Service operations | Poll public dependencies without accounts or secret credentials through the GitHub health workflow. Its failed-run notification delivery follows GitHub notification preferences; this is not evidence of a separately configured email/pager channel. Watch provider quotas and deletion retries. |

## Remaining priorities after this increment

- **Connectivity:** direct WebRTC has no TURN relay. Restrictive networks can prevent calls or profile transfer. A relay needs an explicit bandwidth/cost and privacy decision, credentials with short lifetimes, and real restrictive-network acceptance.
- **Audio platform acceptance:** actual WebView2/Electron device selection, hotplug, echo quality and operating-system permission behavior need hardware checks. Global push-to-talk requires native press/release handling and platform-specific work; an app-window key handler is not equivalent.
- **Account desktop acceptance:** perform installed-desktop restart/session and encrypted-identity restore across two actual devices. Hosted API and crypto tests exercise different boundaries.
- **Email growth:** the initial setup has Supabase's 30-email/hour and Brevo's 300-email/day allowances. A dedicated authenticated sender domain and explicit delivery/abuse alerts are appropriate before a wider launch.
- **Security and governance:** independently review provider contracts and transfer arrangements; exercise backup restoration and incident/request procedures. No legal certification is implied by shipping the notice.

## Primary references

- [Discord account logout](https://support.discord.com/hc/en-us/articles/209572128-How-do-I-log-out)
- [Discord voice controls and troubleshooting](https://support.discord.com/hc/en-us/articles/360045138471-Discord-Voice-and-Video-Troubleshooting-Guide)
- [Discord mic testing](https://support.discord.com/hc/en-us/articles/360020641332-Mic-Testing)
- [Discord input modes and browser shortcut limits](https://support.discord.com/hc/en-us/articles/211376518-Voice-Input-Modes-101-Push-to-Talk-Voice-Activated)
- [Slack huddle preferences](https://slack.com/help/articles/1500002037922-Adjust-your-huddles-preferences)
- [Zoom audio tests](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062765)
