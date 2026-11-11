# Friends and Conversations

Friends remains the dedicated overview: full-width friend rows, search, All/Online filters, incoming and outgoing requests, add/import flows, profile and nickname management. A row opens its profile card; its single message action enters Conversations. Calls stay in the selected conversation header and profile card.

Conversations uses the existing People list beside the selected direct chat. The persistent direct-message controller continues to own signing-identity cache, history, drafts, unread/read state and asynchronous selection guards. Initializing its transport never opens a conversation. Visiting Friends or another destination hides it while retaining drafts. Narrow windows use the list/back flow.

Support Vumiro sits above the account profile card and opens the existing Support settings content. Servers has its own navigation entry and an isolated `serverWorkspace` mount. `window.VumiroWorkspace` owns destination transitions; Servers and Gaming use the same unsaved-settings exit gate, preserve a running room as a hidden frame, and hide the other workspace. Room acceptance suspends every auxiliary workspace without destroying drafts. Destination changes emit `vumiro-workspace-change` with `{view}`.

Desktop social alerts route once through the native corner notification even when focused. Browser sessions retain in-app popups. A foreground incoming call keeps its centered explicit accept/reject card; background calls can additionally alert through the native host.

Focused regressions cover overview/message actions, keyboard selection, filter and nickname behavior, settings exit refusal, initialization without conversation, server/room transitions, native/browser notification routing, preserved direct-message state, Gaming lifecycle, and Linux smoke readiness. No version bump, release, production deployment or installed-profile modification is included. Automated checks establish readiness for LOCAL QA, not human acceptance.
