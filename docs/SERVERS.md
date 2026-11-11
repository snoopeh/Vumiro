# Local server sandbox

Servers currently provide one local **Workshop** demo for testing the workspace design. The centered space uses a thin red rule and server monogram, with compact Overview/Channels navigation and Manage/Connections utilities. Overview continues the selected text conversation with its latest saved local message, then shows compact channel cards with descriptions and actual local message previews. If a voice preview was selected, Continue opens the first available text channel. Search filters channel names and categories, keeps its query across page changes, and offers an explicit reset. Its people and presence are simulated and separate from the real friends list. No server service, voice transport, microphone, invitations, or remote moderation is connected.

Conversations use a wrapping horizontal channel index above a bounded reading area and composer. The message list scrolls to its latest message after attachment on opening, switching channels, and posting. Selecting a text channel focuses its composer; selecting a voice preview keeps focus on that channel control. Page navigation focuses the corresponding page control. Search updates only channel results, preserving its native input and IME composition. Simulated members appear in a collapsed Overview disclosure rather than a permanent members rail. Voice cards and channel views explicitly identify their preview status.

Text channels accept local messages and preserve independent drafts across navigation and reload. Manage can rename the space, edit its description, create text/voice channels, rename channels, regroup their categories, edit descriptions, and change simulated role labels. Role changes preview appearance and do not grant permissions. The member preview never claims that real people are connected.

## Integration

Load `server-workspace.js` before use. The module exposes `window.VumiroServers` and owns only its provided mount:

```js
const servers = window.VumiroServers.create({
  mount: document.getElementById('serverWorkspace'),
  getProfile: () => profile, // current {id, name}, or null
  onExit: () => showFriendsOverview(),
  t: text => window.VumiroI18n?.t(text) || text
});
await servers.open();
servers.hide();
servers.refreshLabels();
servers.destroy();
```

`create` is synchronous. `open()` returns a promise resolving `true` after rendering, including the explanation shown when no profile exists. It resolves `false` if hidden, destroyed, or superseded while loading. `hide()` releases view listeners and preserves state/drafts. `destroy()` also clears the mount and makes later `open()` resolve `false`. The host owns routing/settings guards and must call `hide()` when leaving. No window/document listeners or timers are installed.

`getProfile().id` must be the current 43-character base64url signing identity. The module checks identity at open and before actions. Identity changes reset the in-memory workspace and reload the new identity's data. No profile mutator or friends transport is used. Missing identity displays an explanation with no editable sandbox controls.

Optional `labels` maps English source strings to translated strings; optional `t(source)` translates other labels. `refreshLabels()` renders the current page again. User-authored names, categories, descriptions, messages, timestamps, and draft fields use `data-i18n-skip`. They are rendered using `textContent` and form values; the module does not parse HTML.

## Storage and future boundary

The default async adapter uses bounded localStorage under `vumiro.server-sandbox.v1.<profile.id>`. The space is **not** part of account sync, exported friend data, direct-message storage, or real server management. A fresh deterministic demo is only persisted after its first change/navigation. Load corruption or denied storage shows a recovery explanation. Failed writes retain usable in-memory edits and explicitly report that saving is unavailable; a later edit retries saving.

An optional `storage` argument accepts `{async load(identity), async save(identity, state)}`. `load` returns `null` for a new space or a schema-v1 state. Writes serialize so delayed saves do not replace newer edits. The host should use only one active controller per identity; concurrent browser tabs do not merge updates. A remote implementation will need its own authenticated adapter, authorization model, concurrency controls, real membership/presence, and voice transport. Replacing this local adapter alone does not provide those features.

Public test seams are `createStore({identity,storage,now?})`, `createLocalStorageAdapter(storage)`, `validateState(state,identity)`, and `LIMITS`. Store methods return promises: `updateServer`, `selectChannel`, `setDraft`, `postMessage`, `addChannel`, `updateChannel`, and `setRole`; `snapshot()` returns detached state and `status()` returns saving/recovery status.

The schema permits 20 channels, 40 recent messages per text channel, 1,000 characters per message/draft, 64 per space name, 48 per channel name, 40 per category, and 280 per description. The local adapter rejects serialized data above 1,500,000 characters. Stored channels, messages, roles, identities, dates, and field bounds are checked before rendering. Text/voice kinds cannot be changed after channel creation. Deleting channels or spaces is intentionally absent from this first prototype.

## Verification

Run `node --test tests/server-workspace.test.mjs` and `node --check Vumiro.Client/WebServer/server-workspace.js`. The scoped tests cover identity isolation, bounded histories, validation, role/channel management, draft persistence, asynchronous write ordering, corrupt/denied storage, safe DOM content, UI navigation, persisted conversation previews, channel search/reset and caret focus, collapsed member context, stale loading, teardown, and identity changes. The DOM harness checks interaction behavior; visual acceptance uses the native LOCAL QA app as a separate integration check.

## App-authored English strings

The localization owner can reuse existing catalog keys and add the following source strings. Validation failures also use bounded English field messages from the store.

```text
Local sandbox
Servers / Your space
Overview
Channels
Manage
Connections
Back to friends
Your local test space
Try conversations and shape this space. Changes stay with this profile on this device.
Open a channel
Continue conversation
Search channels
Clear search
No channels match your search.
Demo members online
Demo members
Channel index
People in this space
Simulated presence · Local preview
Online
Away
Offline
Host
Moderator
Member
Voice channel
Text channel
Voice is not connected
This channel is a layout preview. No microphone, audio connection, or remote members are connected.
Preview only
Channel messages
Demo
Local
No messages yet. Start a local conversation.
Message this channel
Write a local message…
Only you can see these messages.
Post locally
Space details
Management changes affect this local demo only.
Server name
Description
Save space
Create a channel
Channel name
Category
Channel type
Create channel
Edit channels
Save channel
Role preview
Preview labels for simulated members. This does not grant real permissions.
A local prototype, ready for a future server adapter.
Server service
Voice service
Not connected
Member presence
Simulated
Message delivery
This device only
Storage
Local to this profile
No invitations, authentication, remote moderation, or voice sessions are sent from this sandbox.
Server workspace
Local data could not be loaded. A fresh demo is shown.
Loading local space…
Create or restore a profile to use this local sandbox.
Saved on this device · No server connection
Saving on this device…
Changes are in memory. Local saving is unavailable.
Local demo · No server connection
You
```
