# Community Hub local model

`Vumiro.Client/WebServer/community-model.js` is a dependency-free browser IIFE exposing `window.VumiroCommunityModel`. Load it before the Community Hub view. This implementation is **LOCAL DEMO**: messages are device-local, members and voice participants are simulated, and access checks are permission previews. It creates no remote membership, invitation, message delivery, or voice session. A future service must authorize operations, history, assets, subscriptions, and ongoing media independently.

## Setup and persistence

```js
const model = window.VumiroCommunityModel;
const store = await model.createStore({
  identity: profile.id,
  storage: model.createLocalStorageAdapter(window.localStorage)
});
```

An identity is the existing 43-character profile identity. Each store captures its identity permanently; changing the active profile requires creating another store. A view must reject stale asynchronous results after identity switches. `snapshot()` returns a detached copy for owner-side rendering. Do not use its raw messages, nodes, or members when rendering a role/member preview: use the filtered query methods below.

The adapter reads `vumiro.community.v2.<identity>` first, then the existing `vumiro.server-sandbox.v1.<identity>` or migration backup. A migration creates folders for flat categories and retains channel IDs, text, drafts, selection, member role labels, and original simulated messages. Hub/folder IDs avoid collisions with old channel IDs.

Before writing a migrated snapshot, the adapter copies the exact original record to `vumiro.community.v2.backup.<identity>` and verifies that readback. The original v1 key and backup remain after success. Every v2 write is validated before writing, compared against its readback, and validated again. Invalid or interrupted v2 data falls back to valid legacy data. A storage failure keeps the working state in memory and reports `saved:false,error:'save'`; the next edit retries the complete current snapshot. Writes are serialized, and only the latest revision can report saved. The adapter never removes another identity's keys.

A custom storage adapter implements asynchronous `load(identity)` and `save(identity,state)`. It may implement `backup(identity)` for legacy retention; custom adapters own their durability/readback guarantees. `now()` can be injected for deterministic messages. Without storage, edits remain in memory and saving is reported unavailable.

`status()` returns `{saved,error,recovered,fresh,migrated}`. `error` is `''`, `'load'`, or `'save'`. `recovered` means invalid/unreadable input required a fresh demo; `migrated` means the store loaded legacy data. `flush()` awaits queued writes.

## Version 2 state

```js
{
  version: 2, mode: 'local-demo', identity,
  hubs: [{
    id, name, description, ownerId,
    roles: [{id, name, authority, permissions: {view:true, post:true}}],
    members: [{id, name, roleIds, role, status, activity, demo}],
    access, home, themeBinding, allowEqualAuthorityModeration:false
  }],
  nodes: [{
    id, hubId, parentId:null, kind:'folder', name, description, order,
    archived:false, managerIds:[], access, home, themeBinding, participantIds:[]
  }],
  selectedHubId, selectedNodeId, collapsed:[],
  messages: {[channelId]: [{id,authorId,author,text,at,demo}]},
  drafts: {[channelId]: ''}, unread: {[nodeId]: 0}
}
```

Node kinds are `folder`, `space`, `text`, and `voice`. Folders and Spaces can contain any node kind. Channels are leaves. IDs are stable; moves change parent/order and, for cross-hub moves, descendant hub IDs. Messages and drafts stay keyed by channel ID. Cross-hub moves retain simulated message authors in destination membership. Archiving hides the entire subtree without deleting content. Restoring an ancestor reveals its unarchived descendants.

`snapshot()` also derives `name`, `description`, `members`, `channels`, and `selectedChannel` for compatibility with the previous sandbox. `channels` contains all text/voice leaves in the selected hub with a derived parent category. These fields are not separately persisted.

`validateState(value,identity)` validates and normalizes a detached v2 state, rejecting identity mismatch, duplicate/reserved IDs, cycles, invalid parents, excessive payloads, invalid role references, forged message authors, and malformed access dimensions. Store edits validate atomically before persisting; invalid edits leave the previous state intact. Current local limits: 20 hubs, 500 nodes, 500 members per hub, 40 messages per text channel, 1,000-character messages/drafts, and a 1,500,000-character serialized storage budget. These are local prototype limits, not advertised live capacity.

## Tree and content operations

All mutation methods are asynchronous and persist the resulting state. Storage errors are exposed through `status()` without discarding edits. Validation/permission errors reject with an `Error`. Options accept `{actor: memberId}` for local authorization testing and default to the profile owner.

| Method | Contract |
| --- | --- |
| `createHub({name,description})` | Creates and selects a hub; returns hub. |
| `updateHub(hubId,patch,options)` | Edits name/description or equal-authority setting. |
| `createNode({hubId,parentId,kind,name,description,access,managerIds,home,themeBinding},options)` | Creates a node; returns node. Hub defaults to selection; parent defaults to hub root. |
| `updateNode(id,{name,description,managerIds},options)` | Edits supported node fields. Assigning managers requires role-management permission. |
| `renameNode(id,name,options)` | Renames a node. |
| `moveNode(id,parentId,{hubId,index,actor})` | Requires source node, source parent and destination structure permissions; rejects cycles and leaf destinations. `null` parent means hub root. |
| `reorderNode(id,index,options)` | Changes sibling order using the same move rules. |
| `archiveNode(id,options)` / `restoreNode(id,options)` | Hides/restores without deleting content. Scoped managers can restore their own scope while access restrictions still apply. |
| `archivedNodes(hubId,actor)` | Returns archived nodes the actor can restore. Restore ancestors before descendants. |
| `selectHub(hubId,options)` / `selectNode(id,options)` | Selects home/node; selecting a node clears its unread count. `selectChannel` aliases `selectNode`. |
| `setCollapsed(id,boolean)` | Persists folder/Space collapse state. |
| `setDraft(id,string,options)` / `postMessage(id,text,author,options)` | Requires text channel and posting permission. Posting clears only that channel's draft. Returns created message. |
| `setUnread(id,count)` | Stores local unread count. |
| `tree(hubId,{query,actor})` | Returns visible preorder rows with `depth`, `matched`, `hasChildren`, `collapsed`. Search reveals matching ancestors despite collapse. |
| `breadcrumbs(id,actor)` | Returns accessible ancestors including hub and node. |
| `getMessages(id,actor)` / `participants(id,actor)` | Returns content only when accessible; participants must themselves have current access. |
| `visibleActivity(hubId,actor)` | Returns newest accessible messages, each with `nodeId`. |
| `unreadTotal(hubId,actor)` | Excludes inaccessible and archived content. |

## Access and authority previews

`DIMENSIONS` exports `view`, `post`, `joinVoice`, `speak`, `moderate`, `structure`, `themes`, and `roles`. Hub roles grant dimensions independently. Hub owner has full local control. The default roles are Host (authority 100), Moderator (50), and Member (10). Higher numbers indicate greater authority; roles can share a bracket.

```js
const access = {
  mode: 'restricted', // all | joinable | approval | invite | restricted
  roleIds: ['Moderator'],
  memberIds: [],
  joinedMemberIds: [],
  invitedMemberIds: [],
  permissions: {
    post: {allowRoles:[],denyRoles:[],allowMembers:[],denyMembers:[]}
  }
};
```

Hub membership is always required. Every ancestor must admit the member. `all` admits hub members; `restricted` admits listed roles/members; `joinable` and `approval` additionally admit joined members; `invite` additionally admits invited members. Listed `memberIds` represent explicit admission. The local model does not send join requests or invitations. Unknown dimensions are rejected. Explicit denies remain effective throughout the subtree; a child allow cannot defeat an ancestor deny. Denied viewing disables every other dimension.

`managerIds` grants view, moderation, structure and theme management to members within that node's subtree, subject to inherited access. It grants no hub/sibling management or role management. Moving a managed root outside that scope also requires permission at its existing parent.

| Method | Contract |
| --- | --- |
| `setAccess(id,access,options)` | Replaces access; requires role-management dimension. |
| `previewAccess(id,actor,draftAccess?)` | Returns effective dimension booleans, `localPreview:true`, and reason. Optional draft access is evaluated without saving. |
| `setRole(memberId,roleId,hubId,options)` | Assigns one existing role to a member. Hub defaults to current hub. |
| `setRoles(hubId,roles,options)` | Replaces role definitions, including authority and dimension grants, subject to full validation. |
| `canModerate(actor,targetMemberId,scopeId)` | Requires moderation, protects owner/self, then compares highest role authority. |

Preview actor can be a member ID or `{roleIds:['Member']}` for a role-only local preview. `evaluateAccess(state,id,actor)` and `canModerate(state,actor,targetMemberId,scopeId)` are exported pure helpers. Equal-authority moderation is disabled unless explicitly enabled on the hub with `updateHub`. It never allows moderating the hub owner. Changes take effect on the next query; preview views must rerender through filtered queries after permission changes.

## Homes and themes

`setHome(id,{preset,welcome,featuredIds,announcements,showActivity},options)` configures a hub/folder/Space home. Presets (`HOME_PRESETS`) are `compact`, `banner`, and `split`. Renderers must filter featured IDs through effective visibility before displaying names or previews.

`setThemeBinding(id,binding,options)` requires theme permission. Bindings are `{mode:'inherit'}` or `{mode:'package',packageId,version,overrides:{}}`; package mode may be omitted on input. Themes are interpreted and validated by the separate theme engine. A binding contains no executable content or membership grants. The seed uses `viking@1.0.0` for Valheim and `cyberpunk@1.0.0` for Cyberpunk.

## Focused verification

Run `node --test tests/community-model.test.mjs`. Tests cover migration backup/readback failures and interrupted writes, identity switches, serialization, stable-ID moves and rollback, cycles, archive restoration, collapse/search, draft/history retention, access inheritance, delegation, equal authority, home presets, and theme bindings. Live concurrency/revocation, authenticated history/asset access, and media cleanup require the later service stages.
