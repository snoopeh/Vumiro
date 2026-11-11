# Friend direct messages

**Messages** is independent of rooms. Choose a friend's **Message** button or open the Messages navigation entry. Conversations persist when a call ends. Text can be stored for a friend who is offline and recovered from their inbox when they reconnect. Enter sends; Shift+Enter adds a line break. A failed request leaves the draft, and retrying an uncertain send reuses the original signed message ID.

**Stored** means the service acknowledged durable storage. It does not mean the recipient has read the message. This first slice has text messages and paginated history; direct-message attachments, group conversations, read receipts and push delivery to a fully quit app are not included.

## Why a server is required

A local archive cannot deliver while its computer is powered off. Offline delivery needs an always-on mailbox: a hosted service or a private machine reachable by both friends. The first implementation uses Vumiro's existing Cloudflare connection service with one SQLite Durable Object per conversation. The directory handles identity authentication, friendship/block admission, inbox summaries and live delivery; it does not hold the full message log. Conversation storage has constant-cost usage counters and indexed sequence pagination.

This follows Cloudflare's [logical-unit object design](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) and SQLite storage recommendation. SQLite-backed objects are available on the [Workers Free plan](https://developers.cloudflare.com/durable-objects/platform/pricing/), subject to its request, compute and storage limits. This change creates no subscription and promises no unlimited free hosting.

## Authentication and privacy

The existing directory challenge proves the signing identity. Each message additionally signs its sender, recipient, ID, timestamp, text and public key. The service checks the current authenticated sender, signature and both users' last authenticated friend/block state. A friend who is offline uses that last published state; purely local changes cannot reach the server until reconnect. The recipient revalidates the signature and participants before display, including locally cached messages.

Messages are **server readable, not end-to-end encrypted**. The server stores text, participant IDs, public signing material/signature, client timestamp, storage timestamp and conversation sequence. Directory state includes the last authenticated friend/block lists, latest inbox summary per friend, and request budgets. Each desktop keeps a separate identity-scoped IndexedDB cache and local read markers. Account backup/export/deletion does not currently manage the direct-message mailbox. Existing privacy-contact procedures apply; there is no in-app direct-message deletion/export control in this slice.

Initial service limits: 4,096 UTF-8 bytes per text; 10,000 messages or 8 MiB per conversation; 60 mailbox requests per minute and 2,000 per day per signing identity. The composer also limits input to 2,000 characters. Reaching quota returns an explicit error and retains the draft; existing messages are not automatically expired. These limits are source policy, separate from the provider's account-wide quotas.

## Hosting boundary

The client uses the versioned `vumiro-dm-v1` signed envelope and `dm-send`, `dm-history` and `dm-inbox` directory operations. A compatible hosted or self-hosted connection service can implement the same protocol; the mailbox SQL is isolated from the UI. The Node private archive documented in [storage setup](../storage/README.md) is an archive, not this always-on mailbox service. A turnkey Node mailbox adapter, export/import migration, and automatic endpoint migration are later work. Changing the service URL does not move existing messages.

## Local QA and deployment

The new service is deliberately **not deployed to production** during implementation. Old services advertise no `directMessages` capability; the app explains that sending needs the updated service rather than falsely marking messages stored.

From `cloudflare/`, run asset preparation and the isolated Worker:

```powershell
npm run prepare-assets
npx wrangler dev --config wrangler.storage.jsonc --ip 127.0.0.1 --port 8787 --local --persist-to ../dist/local-qa/worker-state
```

Then from the repository root run `./scripts/Run-Local.ps1 -LocalService`. The native window must say **LOCAL QA · LOCAL SERVICE**. Both test identities must use this local service; installed friends remain on the production directory. No installed profile or credentials should be copied into the fixture.

`node tests/direct-messages-worker.e2e.mjs` uses disposable signing identities, the production browser transport, real WebSockets and local SQLite Durable Objects. It rejects remote URLs. It checks live delivery, offline storage/reconnect inbox, pagination, retry idempotency, nonparticipant denial and persisted recipient blocks. The report is `dist/direct-messages-e2e.json`.

After human acceptance and an explicit release request, deployment must retain the existing v1/v2 namespaces, add the additive v3 `DirectConversation` migration in `wrangler.storage.jsonc`, and publish both storage owner and public Worker with their matching bindings/assets. No unrelated account-D1 migration is required.
