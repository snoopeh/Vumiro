-- Pending authentication-provider deletions are durable jobs. Completed
-- tombstones keep using expires_at to reject already-issued access tokens.
ALTER TABLE deleted_accounts ADD COLUMN requested_at TEXT;
ALTER TABLE deleted_accounts ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deleted_accounts ADD COLUMN last_attempt_at TEXT;
ALTER TABLE deleted_accounts ADD COLUMN last_error TEXT;
ALTER TABLE deleted_accounts ADD COLUMN next_attempt_at TEXT;
ALTER TABLE deleted_accounts ADD COLUMN completed_at TEXT;

UPDATE deleted_accounts
SET requested_at = COALESCE(requested_at, expires_at),
    next_attempt_at = CASE WHEN state = 'pending' THEN COALESCE(next_attempt_at, datetime('now')) ELSE NULL END;

CREATE INDEX IF NOT EXISTS deleted_accounts_pending_retry
ON deleted_accounts(state, next_attempt_at);

-- recorded_at is authoritative; accepted_at is the time reported by the app.
CREATE TABLE IF NOT EXISTS account_notice_acceptances (
  account_id TEXT NOT NULL,
  notice_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  device_id TEXT NOT NULL,
  PRIMARY KEY (account_id, notice_version)
);

CREATE INDEX IF NOT EXISTS account_notice_acceptances_recorded
ON account_notice_acceptances(account_id, recorded_at);

-- Fixed-window account limits complement edge/provider rate limits.
CREATE TABLE IF NOT EXISTS account_rate_limits (
  account_id TEXT NOT NULL,
  action TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (account_id, action)
);
