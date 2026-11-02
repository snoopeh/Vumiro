# Vumiro social and room protocol

All social messages use the existing authenticated `/friends-signaling?id=ID`
WebSocket. Identity challenge/authentication and signed legacy invite/answer
canonical strings remain unchanged. IDs are SHA-256 of P-256 public SPKI,
base64url without padding. Signatures are 64-byte P-256 ECDSA SHA-256 in that
encoding. Timestamps are Unix milliseconds. Object payload property order is
significant: preserve the received payload when verifying a social signature.

## Online profile and lookup

After `ready`, send `{type:"profile-announce",name,username,blockedIds}`.
`name` is nonempty, trimmed, control-free, at most 48 characters. `username`
is optional (empty means none), lowercase `[a-z0-9_.-]{3,24}`. `blockedIds`
is optional (default `[]`), at most 128 distinct IDs. The server returns
`{type:"profile-ready",profile:{id,name,username,key}}`. Username collision
returns `{type:"social-error",code:"username-taken",message}` and leaves the
previous profile intact. Handles are reserved only while this socket is online.
Reconnect must reannounce profile, blocks, watch IDs and owned room state.

Send `{type:"lookup",query,nonce}` with a fresh 16–64 character base64url nonce.
Query accepts `@username`, username, exact identity ID, or a complete
`stfriend1.` public contact code. Response is
`{type:"lookup-result",nonce,profile:null|{id,name,username,key}}`; only an online,
announced, unblocked profile is returned. Public contact codes remain a local
offline fallback, never upload private keys. Lookup does not reveal friendship,
presence subscriptions or rooms.

## Durable friend requests (version 2)

Directory `ready` includes `serverTime` and `socialVersion:2`. Clients announce `socialVersion:2` with their profile, and public directory profiles include this capability. Server time is anchored to a monotonic browser clock; no periodic time requests are made. Room challenges also supply serverTime for grant checks.

Friend `social` envelopes add `version:2` and use the canonical prefix `vumiro-social-v2`, with the remaining fields and payload order below unchanged. Initial requests require an online version 2 recipient and expire within 24 hours of server time. Answers expire within 120 seconds and may be stored for an offline requester. Duplicate requests and equivalent repeat answers return the canonical stored outcome; conflicting decisions are rejected.

The service durably stores bounded request/answer proofs and public profiles, then acknowledges with `social-sent`. It pushes `friend-state` containing signed `request`, optional signed `response`, the viewer's peer `contact`, `state` (pending/accepted/declined/cancelled), server `expires` and `delivered`. Relevant states replay after profile announcement on reconnect. Each client verifies roles and signatures and applies accepted friendship with a local atomic completion record.

`{type:"friend-received",requestNonce,phase:"pending"}` acknowledges recipient delivery. Phase `resolved` acknowledges a local terminal commit; both acknowledgements allow deletion. `{type:"friend-cancel",requestNonce}` cancels a pending request owned by the authenticated sender. Terminal records expire within seven days even without both receipts. Limits are 32 outstanding rows per identity and 1,024 globally. Indexed SQLite lookups, pushes and one-shot expiry alarms replace polling.

## Legacy signed requests and room answers (version 1)

Client envelope: `{type:"social",to,kind,nonce,expires,payload,signature}`.
`kind` is `friend-request`, `friend-answer`, `join-request`, or `join-answer`.
Expiry must be in the next 120 seconds. Canonical signed string:

```text
vumiro-social-v1\nFROM\nTO\nKIND\nNONCE\nEXPIRES\nJSON.stringify(payload)
```

Forwarded envelope contains the same fields plus trusted `from` and
`profile:{id,name,username,key}` from the authenticated sender attachment.
The receiver must validate the key-to-ID binding and signature, expiration,
recipient, replay nonce, and pending request linkage before acting.

Exact payloads:

* Friend request: `{}`.
* Friend answer: `{requestNonce,accepted}`.
* Join request: `{room}`.
* Join answer: `{requestNonce,room,accepted}` when declined; when accepted,
  `{requestNonce,room,accepted:true,grant:{nonce,expires,signature}}`.

Friend requests may route before friendship. Only online announced profiles can
exchange them. Friend answers require an unexpired request from `to` to `from`;
the answer does not itself alter server friendship. On acceptance both clients
save the verified public contact locally and send their updated watch lists.
Join requests and answers require current mutual watch membership and the
recipient/request owner must currently publish the specified room. Answers are
linked to the request nonce, sender, room and kind. Request acceptance stays an
explicit local UI action. Replies cannot be treated as unsolicited friendships.

Success acknowledgement: `{type:"social-sent",to,nonce}`. Unavailable/blocked or
expired destination: existing `{type:"unavailable",to,nonce}`. Recoverable social
errors: `{type:"social-error",code,message,nonce?}`. Pending requests live only in
the sending socket attachment; disconnect/replacement loses that mailbox.

## Rooms, live state and owner approval

Existing `{type:"watch",ids}` publishes the local contact IDs (at most 128).
`{type:"room-state",room,live,mode?}` publishes one owned room or `room:null` (with
`live:false`) to clear it. A room is `OWNER_ID` + `_` + 48 lowercase hex chars;
only the authenticated owner can publish it. `live` is boolean.
`mode` is `public`, `friends`, `private`, or `legacy` (default). It is a discovery
hint; the independently authenticated room owner policy controls admission.
`{type:"rooms",rooms:[{owner,room,live,mode}]}` is the complete current snapshot for
the receiving identity. Snapshots are pushed after watch changes, room state
changes, connect/replacement/disconnect, and profile block changes. A room
appears only to current mutual friends and never to either blocked party.
Existing per-ID presence events also require mutual friendship and no block.
An online presence event includes optional `profile:{id,name,username,key}` once
that identity has announced its profile. Profile announcements push this event
again so mutual friends can refresh current public names without polling or a
burst of lookups.
No polling, cloud chat, avatar or media relay exists. Account data uses the separate authenticated `/api/v1/account/*` HTTP API and D1 database documented in [ARCHITECTURE.md](ARCHITECTURE.md); it does not change the signed signaling protocol described here.

An accepted social join includes an owner-signed grant for legacy compatibility.
Grants authorize admission only when the room owner uses the legacy protocol.
They never bypass a modern room policy or password. Grant canonical string:

```text
vumiro-room-grant-v1\nOWNER\nTO\nROOM\nNONCE\nEXPIRES
```

Grant nonce is 16–64 base64url characters; expiry must be in the next 24 hours.
The owner signs with its local identity key. A legacy `invite` may include an
optional `grant` with the same format and binding; its original invite signature
canonical string stays unchanged and the grant has its own signature.
The room URL can carry `grant=JSON.stringify(grant)`; pass the parsed grant as
the optional `grant` field of `room-authenticate`. A legacy room nonowner must supply a valid
owner-signed grant and both sides must currently list each other as friends.
The room owner must be online; guests missing approval receive a readable
request-approval/update message. The owner requires no grant. Room friend list
revision signatures and revocation remain enforced.

## Modern room privacy (v2)

The room owner must be online in every mode. New owners use signed v2
authentication and default to `friends`. Legacy owner authentication remains
unchanged, retaining mutual friends plus grants. Exact owner policy shapes:

* `{mode:"public"}`: any authenticated local identity holding the room code.
* `{mode:"friends"}`: current mutual friendship with the owner; no grant required.
* `{mode:"private",salt,verifier}`: a valid password proof; friendship and grants
  do not replace the password.

Private `salt` is 16 random bytes and `verifier` is 32 bytes, both canonical
base64url. The client derives the verifier as PBKDF2-SHA256 with 150,000
iterations and the UTF-8 password. The owner transmits that derived key only
inside its signed authentication/policy message. The Worker keeps it only in
the authenticated owner socket attachment, never persists it to a database or
forwards it. Plaintext passwords never enter URLs, directory state or Worker
messages. Private material sent from a trusted parent to its room iframe uses
same-origin `postMessage` and remains client memory only.

The existing challenge adds `policy` and `policyRevision`:
`{type:"room-challenge",nonce,room,id,policy,policyRevision}`. Public policy is
`{mode:"public"}`, `{mode:"friends"}`, `{mode:"private",salt}`, `{mode:"legacy"}`,
or `{mode:"offline"}` when the owner is absent. It never contains `verifier`.
The connecting owner sees the default friends policy/revision 1 and chooses
its signed policy. A legacy online owner has policy revision 0.

V2 authentication:
`{type:"room-authenticate",version:2,key,signature,friends,blockedIds,policy,policyRevision,passwordProof?,grant?}`.
Friends and blocks are unique lexically sorted identity IDs, at most 128 each
and 192 combined. The owner supplies its exact policy with revision 1; a guest
supplies `policy:null` and the revision from its challenge. Canonical string:

```text
vumiro-room-v2\nROOM\nID\nCHALLENGE_NONCE\nFRIENDS_JOINED_BY_COMMA\nBLOCKED_IDS_JOINED_BY_COMMA\nPOLICY_REVISION\nJSON.stringify(policy)\nPASSWORD_PROOF_OR_EMPTY
```

A private guest derives the same key from the locally entered password and
challenge salt, then sends a 32-byte base64url HMAC-SHA256 `passwordProof` over:

```text
vumiro-room-password-v1\nROOM\nID\nCHALLENGE_NONCE\nPOLICY_REVISION
```

The identity signature also binds the proof. The server rechecks the active
owner, owner session nonce, policy revision, current blocks/friendship and
30-second challenge deadline after all cryptographic awaits. A changed owner
or policy requires a fresh challenge. V1 guests must update before joining a
modern-policy room. V2 guests may join legacy rooms with a valid legacy grant.

Owner updates:
`{type:"room-policy",revision,policy,blockedIds,signature}`. Revisions start at 2
and increase monotonically within the owner session. Exact canonical string:

```text
vumiro-room-policy-v1\nROOM\nOWNER_ID\nOWNER_CHALLENGE_NONCE\nREVISION\nJSON.stringify(policy)\nBLOCKED_IDS_JOINED_BY_COMMA
```

The Worker sends remaining participants
`{type:"room-policy",policy:{mode,salt?},policyRevision}` and includes the same
sanitized policy/revision in `welcome`. Changed private credentials or a
transition into private mode evict previous guests; they must reconnect with a
fresh proof. A block-only private update retains other valid password guests.
Friend and block changes immediately reapply admission rules. Pairwise blocks
also filter peer announcements and signaling between nonowner guests.

V2 friend/block updates:
`{type:"room-friends",version:2,friends,blockedIds,revision,signature}` with
monotonic friend revision >=1. Canonical string:

```text
vumiro-room-friends-v2\nROOM\nID\nCHALLENGE_NONCE\nREVISION\nFRIENDS_JOINED_BY_COMMA\nBLOCKED_IDS_JOINED_BY_COMMA
```

For the owner, only `room-policy` updates its block list; `room-friends` updates
its friend list while still verifying the signed block field. This gives
owner block changes one monotonic authority and prevents two independently
verified revision streams from restoring stale blocks. Guests update their
blocks through `room-friends`. Legacy friend revisions/canonical strings remain
unchanged. Room attachments stay below 16 KiB, with at most eight authenticated
participants and 24 total pending/active sockets. No room title, password,
verifier, avatar or chat is included in directory discovery.

## Direct online-friend profile signaling

Short `vm1.` contact codes are decoded to the public SPKI/identity on the
client before lookup. No compressed-key decompression is required in the
directory. Automatic public profile/avatar updates travel over peer WebRTC,
with this directory message only establishing the direct connection:

`{type:"profile-signal",to,nonce,expires,payload,signature}`; the forwarded event
adds trusted `from`, preserving the signed payload property order. Canonical:

```text
vumiro-profile-signal-v1\nFROM\nTO\nNONCE\nEXPIRES\nJSON.stringify(payload)
```

Expiry is in the next 15 seconds, nonce is 16–64 base64url characters, and
signature is P-256 ECDSA SHA256 as above. Exact payload alternatives are
`{description:{type:"offer"|"answer",sdp}}`, `{candidate:null|candidateObject}`,
or `{refresh:true}`. SDP is at most 12,000 characters. Candidate text is at most
4096, `sdpMid`/`usernameFragment` at most 256, `sdpMLineIndex` 0–64; optional
candidate fields may be null. Only those candidate fields are accepted.
TURN/relay candidates are rejected. Profile/photo/chat payloads are rejected.
Routing requires current unblocked mutual friendship after signature
verification, and expires on disconnect. This channel uses a separate
256-message/10-second budget and never consumes social pending-request slots.
The receiver bounds nonce replays locally; the directory does not retain a
per-candidate mailbox. A refresh asks the deterministic peer initiator to
negotiate another short profile exchange. No profile payload is forwarded by
the Worker.

## Signed identity transition

An account can rotate a legacy nonextractable identity into a recoverable key.
The new client includes an optional exact `transition` object in
`profile-announce`: `{version:1,fromId,fromKey,toId,toKey,createdAt,signature}`.
The canonical P-256 ECDSA SHA-256 text signed by the old key is:

```text
vumiro-identity-transition-v1\nFROM_ID\nFROM_SPKI\nTO_ID\nTO_SPKI\nCREATED_AT
```

The directory requires `toId` and `toKey` to match the currently authenticated
new identity, verifies both fingerprints and the old-key signature, and rejects
self transitions, malformed fields, and future timestamps. It relays the
transition only when the recipient watches `fromId` and the new identity watches
the recipient, preserving the previous mutual relationship without creating a
public alias. The recipient verifies the old key against its saved contact and
verifies the signature again before replacing the contact ID and key in one
IndexedDB transaction. Replays are idempotent. The transition is re-announced
on later connections so an offline friend can migrate when both peers are next
online; the directory does not persist a transition mailbox.

## Bounds

Directory: 256 sockets, 16 KiB incoming messages, 384 messages/10 seconds/socket. Profile,
lookup, watch and room-state actions share 24 operations/10 seconds. Social
envelopes are limited to 16/10 seconds and friend requests additionally to
4/minute/sender, 2/minute/sender-target, 12/minute/recipient and an aggregate
128/minute across online sender windows. Each socket keeps
at most 8 outbound pending requests and 16 replay nonces. Watch and block lists
each allow 128 IDs, with a combined limit of 192; attachment serialization is
bounded below 16 KiB. No offline delivery or pending replay after reconnect.
