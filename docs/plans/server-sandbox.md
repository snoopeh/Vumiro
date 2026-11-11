# Server sandbox implementation plan

**Goal:** A usable local server workspace for tuning navigation, management, and conversations before a network service exists.

**Architecture:** One independent browser module owns a bounded, identity-scoped asynchronous store and its disposable view. It never uses the friends transport, presence, profile mutation, or audio APIs. Root integrates only navigation, the mount, localization, and packaging.

**Design decisions:** A space dashboard with an editorial header, channel index, quiet member cards, and explicit Connections page. This avoids a stacked icon rail or imitation Discord chrome. A single seeded workspace is more useful for tuning than empty create/join flows; a multi-server network would make unsupported promises. All demo people and statuses are labelled simulated. Voice channels are readable previews with no join button. Management is inline forms, not prompts. Drafts belong to each text channel and survive navigation/reload.

**Files:** `Vumiro.Client/WebServer/server-workspace.js` owns store, validation, adapter, view, and scoped CSS. `tests/server-workspace.test.mjs` tests public store behavior and lifecycle. `docs/SERVERS.md` records the contract and limitations.

- [x] Write tests for validation, identity isolation, bounded messages, drafts, persistence failures, management, and lifecycle; run the scoped test to establish red.
- [x] Implement the asynchronous local adapter and pure command store; verify green.
- [x] Add view tests for safe text, navigation, message submission, draft restoration, identity changes, and teardown; establish red.
- [x] Implement dashboard/channel/management/connections views with native keyboard controls and safe DOM text; verify green.
- [x] Document adapter boundaries and integration, run scoped tests and syntax check, freeze owned source for root integration.

**Verification:** `node --test tests/server-workspace.test.mjs`; `node --check Vumiro.Client/WebServer/server-workspace.js`. No full suite, deployment, release changes, or installs.

The user's autonomous-development instruction permits proceeding with these decisions without an approval gate. No shared shell or friend files are changed by this worker.
