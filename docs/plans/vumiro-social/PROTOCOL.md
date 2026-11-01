# Vumiro 1.15 social protocol

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

## Signed requests and answers

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
`{type:"room-state",room,live}` publishes one owned room or `room:null` (with
`live:false`) to clear it. A room is `OWNER_ID` + `_` + 48 lowercase hex chars;
only the authenticated owner can publish it. `live` is boolean.
`{type:"rooms",rooms:[{owner,room,live}]}` is the complete current snapshot for
the receiving identity. Snapshots are pushed after watch changes, room state
changes, connect/replacement/disconnect, and profile block changes. A room
appears only to current mutual friends and never to either blocked party.
Existing per-ID presence events also require mutual friendship and no block.
An online presence event includes optional `profile:{id,name,username,key}` once
that identity has announced its profile. Profile announcements push this event
again so mutual friends can refresh current public names without polling or a
burst of lookups.
No polling, durable account database, cloud chat, avatar or media relay exists.

An accepted join includes an owner-signed grant. Grant canonical string:

```text
vumiro-room-grant-v1\nOWNER\nTO\nROOM\nNONCE\nEXPIRES
```

Grant nonce is 16–64 base64url characters; expiry must be in the next 24 hours.
The owner signs with its local identity key. A legacy `invite` may include an
optional `grant` with the same format and binding; its original invite signature
canonical string stays unchanged and the grant has its own signature.
The room URL can carry `grant=JSON.stringify(grant)`; pass the parsed grant as
the optional `grant` field of `room-authenticate`. A nonowner must supply a valid
owner-signed grant and both sides must currently list each other as friends.
The room owner must be online; guests missing approval receive a readable
request-approval/update message. The owner requires no grant. Room friend list
revision signatures and revocation remain enforced.

## Bounds

Directory: 256 sockets, 16 KiB messages, 120 messages/10 seconds/socket. Profile,
lookup, watch and room-state actions share 24 operations/10 seconds. Social
envelopes are limited to 16/10 seconds and friend requests additionally to
4/minute/sender, 2/minute/sender-target, 12/minute/recipient and an aggregate
128/minute across online sender windows. Each socket keeps
at most 8 outbound pending requests and 16 replay nonces. Watch and block lists
each allow 128 IDs, with a combined limit of 192; attachment serialization is
bounded below 16 KiB. No offline delivery or pending replay after reconnect.
