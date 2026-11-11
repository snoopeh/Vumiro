# Private chat archive

This optional Node.js service runs on your computer or your own private server. It uses SQLite with WAL, requires no database subscription and has no npm dependencies. Use Node **24.13 or later**; `node:sqlite` still emits an experimental-feature warning on the tested Node 24.13 runtime. The desktop app continues to use peer-to-peer live chat and its existing account service. This archive does not replace either service.

## Start on your computer

In Vumiro, open **Settings → Data & servers** and copy the archive owner ID. It is the signing identity, not your email. In PowerShell, from the repository root:

```powershell
$archiveOwner = 'PASTE_YOUR_ARCHIVE_OWNER_ID'
$archiveToken = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
$env:VUMIRO_STORAGE_TOKENS = @{ $archiveOwner = $archiveToken } | ConvertTo-Json -Compress
# Save this token in your password manager, then paste it into Vumiro.
$archiveToken
Set-Location storage
node server.mjs
```

Choose **On this device + my private server**, enter `http://127.0.0.1:8788` and your token, then **Connect to private archive**. Rejoin the current room. The database is `storage/data/vumiro.sqlite` when started from that folder. Keep the process running while you want private backup. The client token is stored in session storage; enter it again when that browser session ends. Local history remains available without the service.

For a remote machine, place the same service behind an HTTPS reverse proxy, keep Node bound to loopback, and use your own HTTPS origin in the app. `HOST` defaults to `127.0.0.1`, `PORT` to `8788`, and `VUMIRO_STORAGE_FILE` to `./data/vumiro.sqlite`. TLS, DNS and access to that machine are operator setup; this change provisions no paid hosting. To serve the HTTP app as well, explicitly add its origin to the comma-separated `VUMIRO_STORAGE_ORIGINS` list. Defaults permit only the Windows WebView and Linux app origins.

`VUMIRO_STORAGE_TOKENS` is a JSON map of owner IDs to separate random tokens. CLI startup requires tokens at least 32 characters long. Configure the same owner/token pair on each device that restores that signing identity. Do not share one user's token with another user. The token gives read/write access to that owner's archive. The service operator can read stored messages; this version does not encrypt archive contents end to end or cryptographically authenticate the operator. Clients reverify message authors and signatures before display.

## What is saved

- Signed text envelopes and attachment descriptions, isolated by owner, original room, author and message ID.
- Server/channel definitions for the first server groundwork. These are records, not functional shared community servers yet.
- Local IndexedDB history is always written before optional private backup. Backup failure is visible and does not discard the local message. Browser storage can reach quota or be cleared by the user; it is not a guaranteed backup.

The latest 200 records load on re-entering the **same room**. Historical records keep their original timestamps and do not trigger new-message alerts. Private archive restoration verifies the same signed room. New random live rooms have different histories. There is no room-history browser yet. Attachment bytes, offline delivery, membership/invite/role enforcement and automatic backfill of older local history to a newly selected server are not implemented. Data & servers labels these limits explicitly.

## API and future hosting

The versioned HTTP boundary is the same for a local process, a private machine and a future hosted implementation:

| Route | Operation |
| --- | --- |
| `GET /v1/owners/:owner/rooms/:roomHash/messages?limit=100&before=...` | Latest/older history, ascending within a page; maximum 200 |
| `POST /v1/owners/:owner/rooms/:roomHash/messages` | Idempotent signed-envelope append; conflicting content returns 409 |
| `GET /v1/owners/:owner/servers` | Server/channel records |
| `PUT /v1/owners/:owner/servers` | Upsert one server with bounded text-channel definitions |

Every route requires `Authorization: Bearer <owner token>`. The room path is lowercase SHA-256 hex of the original UTF-8 signed room string. The original string remains inside the signed envelope. History cursors are base64url JSON `[timestamp, "authorId:messageId"]`; timestamps alone would lose messages when several share the same millisecond.

Changing the endpoint selects another store; **it does not migrate old data**. For an initial same-service migration, stop the service cleanly, copy its data directory and securely transfer the owner-token configuration, then start the destination and update the URL. Copying a running WAL database file alone is not a safe backup. The schema version is recorded with `PRAGMA user_version`. Keep the API independent of the SQL implementation; a later PostgreSQL adapter can serve it without changing chat rendering. SQLite permits one writer at a time, so do not market this initial single-process service as a large public-chat deployment. Large media should use separate object storage with quotas and retention rather than inline database blobs.

## Checks

From the repository root:

```sh
node --test tests/chat-storage.test.mjs tests/chat-storage-service.test.mjs
```

The HTTP tests use a temporary SQLite database and verify persistence across restart, owner isolation, idempotency, conflict handling and pagination with duplicate timestamps. They do not start a public service or use production profiles.
