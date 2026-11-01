# Vumiro service URL migration

User explicitly requests a Vumiro-branded Cloudflare URL and matching app defaults. Continue autonomous implementation; Luna agents; no app/runtime tests.

Canonical URL: `https://vumiro-rooms.vumiro-signaling.workers.dev`, WebSocket paths `/friends-signaling` and `/call-signaling`. Cloudflare account inventory has only the existing Vumiro service and no zones. Availability endpoint reports account subdomain `vumiro-signaling` is available (10032).

Changing the account workers.dev subdomain changes all service hostnames; older apps must update. Publish 1.21.1 client packages before the account rename to minimize the transition. GitHub updates do not depend on signaling. Preserve Windows local origin/profile directory, storage keys and protocol identifiers.

Do not create replacement Durable Object state. Existing storage owner `screentask-rooms` remains internally under wrangler.storage.jsonc with original v1/v2 migrations. New canonical frontend `vumiro-rooms` binds directly to those two existing namespaces using script_name, without a proxy hop. Verify Cloudflare binding namespace IDs match the originals before switching the account subdomain:

- CALL_ROOMS: `94c55c72903c4d80b15a6c620e3ef41b`
- FRIEND_DIRECTORY: `9902bed8deae4a09b81cdb67f985d3dd`

Deployment script updates storage-owner code and public frontend together; the storage owner's public workers.dev route is disabled after the client release. No classes/data are deleted or transferred. The new URL serves the same six assets and existing signaling code. Client normalizers remap only known production hostnames to canonical; custom services are preserved. Old saved endpoint settings and room invitations normalize without changing identity or contacts.

Ownership: root Cloudflare infrastructure/deploy/account rename, native app defaults, versions/docs/release; room_polish two shared JS normalizers; linux_host read-only official API research. Static/build/package checks and Cloudflare metadata verification only; live room/audio tests remain with the user.

Official references: Cloudflare workers.dev routing, workers subdomain API, Wrangler external Durable Object script_name bindings.
