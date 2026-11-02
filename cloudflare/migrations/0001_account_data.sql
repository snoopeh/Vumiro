-- Account snapshots are kept separate from Durable Object signaling state.
-- They contain only public profile/contact metadata and ordinary preferences.
CREATE TABLE IF NOT EXISTS account_data (
  account_id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL CHECK (length(payload) <= 262144),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS account_data_updated_at ON account_data(updated_at);
