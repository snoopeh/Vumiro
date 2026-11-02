CREATE TABLE IF NOT EXISTS deleted_accounts (
  account_id TEXT PRIMARY KEY NOT NULL,
  expires_at TEXT NOT NULL
);
