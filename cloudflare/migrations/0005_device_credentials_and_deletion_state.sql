ALTER TABLE account_devices ADD COLUMN credential_hash TEXT;
ALTER TABLE deleted_accounts ADD COLUMN state TEXT NOT NULL DEFAULT 'complete' CHECK (state IN ('pending', 'complete'));

CREATE INDEX IF NOT EXISTS account_devices_account_credentials ON account_devices(account_id, credential_hash);
