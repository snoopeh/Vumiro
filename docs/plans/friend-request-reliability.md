# Friend request reliability

User-authorized implementation: replace fragile friend-request lifecycle with event-driven delivery; no polling or runtime tests. Existing v1 traffic and room join flow remain supported. Both peers need the new client for the durable v2 friend flow.

## Clock

`window.VumiroServerClock` in local-profile.js exposes `sync(serverTime)`, `now()`, `isSynced()`. Store server milliseconds plus performance.now() baseline; never change Windows time. Directory `ready` and room `room-challenge` include serverTime. No clock-only HTTP requests. Use server clock for signed expiry/validation; retain normal local clock for display if desired.

## Version 2 friend protocol

- profile-announce accepts optional socialVersion:2; publicProfile includes socialVersion (default1); session remembers capability.
- ready includes socialVersion:2 and serverTime. Client refuses v2 friend actions with a clear message if server capability absent.
- Existing social envelope adds version:2. For v2 friend-request / friend-answer use canonical prefix `vumiro-social-v2`; other fields/signature ordering remain socialText. V1 canonical unchanged.
- v2 friend-request payload {}, signed expires=serverNow+24h minus 5 seconds; server caps at24h. Initial target must be online, profile announced, and socialVersion2; otherwise explicit unavailable/update-required. Offline initial username lookup is outside scope.
- v2 friend-answer payload {requestNonce,accepted}, signed expires=serverNow+115s. Target may be offline: response is stored and pushed on reconnect. Request must remain pending by server expiry. Duplicate identical envelopes return existing state/ack; repeated answers with a new nonce but identical accepted value return existing canonical result. Conflicting answers are rejected.
- Server sends social-sent for requests AND answers only after durable storage succeeds. Client waits for it before claiming sent/accepted. Never await acknowledgements inside the serialized incoming message handler.

## Durable state push

Authenticated parties receive:
```
{type:'friend-state',request:<signed request with from and profile>,
 response:<signed answer with from and profile>|null,
 contact:<other party's public profile>,
 state:'pending'|'accepted'|'declined'|'cancelled',
 expires:<server expiry>,delivered:<boolean>}
```

Validate signed original request/response, roles, requestNonce and contact identity. Pending state hydrates/upserts incoming/outgoing cards. Accepted state atomically adds the other contact and records completion; declined/cancelled records completion without adding. Completed records must never re-add a contact removed later.

- `{type:'friend-received',requestNonce,phase:'pending'|'resolved'}`: authenticated socket is identity proof. Recipient pending acknowledgement marks delivered once and pushes changed state to sender. Resolved acknowledgement follows local atomic commit for either party; delete server row once both parties acknowledge. No acknowledgement loops.
- `{type:'friend-cancel',requestNonce}`: only original sender may cancel a pending v2 request. Push cancelled state to both parties; already terminal requests return current state. Cancel requires no signature beyond authenticated socket ownership.
- Replay relevant rows on profile announce after ready (also after reconnect). Filter blocked identities; do not apply accepted contact for a blocked peer, but acknowledge terminal state to avoid replay loops.
- Pending lifetime24h; terminal records retained up to7days or both receipts. Server expires rows with a one-shot alarm at the next actual expiry, never a polling interval. Client local request expiry UI timers do not make network calls.

## Storage

Use the existing SQLite Durable Object: one bounded friend_requests row per request, indexed by from/to/expiry. Synchronous SQL and transactionSync for row state changes; no socket attachment owns durable v2 pending state. Max32 outstanding rows per identity and1024 globally; enforce existing request rate/block checks. Schedule expiry alarm only when needed. Store public names/keys and signed request/answer proofs; no pictures, private keys, chat or media.

## Local atomic completion

Expose `local.applyFriendResolution({nonce,contact,accepted,nickname,expires},canSave)` returning `{added,alreadyProcessed}`. In one IndexedDB transaction covering friends+state, upsert contact iff accepted, enforce128-contact limit, and persist bounded completion nonces. Duplicate completion must not re-add a subsequently removed contact. Emit friend changed after successful transaction only. Existing local methods stay compatible. local.listRequests is used for pending hydration; reconnect must not erase v2 state.

## Ownership

- Server worker: cloudflare/friend-directory.js only.
- Client worker: friends-client.js and friends.html only.
- Local storage worker: local-profile.js only, including shared clock.
- Root: worker.js room challenge time, call-client.js/peer-profile.js clocks, documentation/version/package/deploy.

No tests, synthetic identities, real-user messages or app launches. Compile/package and read-only source review are permitted. Keep existing updater's six-asset package layout.

API references: [SQLite storage and synchronous transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [one-shot Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).
