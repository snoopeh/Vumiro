# Server and supporter experience refinement

Goal: make the local prototype useful for conversation and give Support its own Vumiro identity.

Critique: the current server home stretches low-density rows and counters across large windows, promotes administration before conversation, and repeats the app header. Support follows the reference composition too closely.

References: [Element navigation](https://element.io/blog/an-unrecognisable-improvement-elements-new-design-is-here/) for reducing navigation steps; [Zulip topics](https://zulip.com/help/introduction-to-topics) for conversation context; [Slack organization](https://slack.com/help/articles/4411352432275-Video--Organize-your-conversations-in-Slack) for readable grouping. These inform interaction principles, not styling.

- [x] Server workspace: bounded content, continue conversation with real persisted snippet, compact channel cards/search, horizontal chat channel navigation, contextual members, retain management and honest local/demo boundaries. Owner: server-workspace.js and its behavior tests.
- [x] Support: asymmetric editorial composition, Vumiro ribbon-inspired motif and small warm accent, no subscription/plan visual language. Owner: support rules/markup in friends.html only. Preserve existing payment destination and translations.
- [x] Remove redundant Friends/room actions while inside server workspace. Owner: scoped host CSS.
- [x] Verify behavior first with server regression tests, relevant shared UI/i18n checks and syntax. Review native UI only without interrupting another agent's QA session. Preserve all other source/worktrees and do not release.

Review corrections: Support compact navigation naming, pane-aware responsive layout and payment-button contrast fixed. Server scrolling now measures after attachment; search retains its native input node to preserve IME composition. Both fixes were verified with failing-then-passing regression tests.

Native visual QA remains pending: the shared QA session has unrelated unsaved controller edits and is deliberately left intact.
