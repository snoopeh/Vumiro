CREATE TABLE IF NOT EXISTS account_devices (
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  label TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (account_id, device_id)
);

CREATE INDEX IF NOT EXISTS account_devices_last_seen ON account_devices(account_id, last_seen);
