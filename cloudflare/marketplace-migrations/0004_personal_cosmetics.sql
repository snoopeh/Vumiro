-- Account-bound display cosmetics never participate in shared hub grants.
CREATE TABLE marketplace_profile_bindings (
 account_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('profile-card','avatar-frame','profile-effect')),
 item_id TEXT REFERENCES marketplace_listings(id),
 version_id TEXT REFERENCES marketplace_versions(id),
 previous_json TEXT,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,kind),
 CHECK((item_id IS NULL) = (version_id IS NULL))
);
CREATE TABLE marketplace_profile_identities (
 peer_id TEXT PRIMARY KEY CHECK(length(peer_id)=43),
 account_id TEXT NOT NULL,
 public_key TEXT NOT NULL,
 linked_at INTEGER NOT NULL
);
CREATE INDEX marketplace_profile_identity_account ON marketplace_profile_identities(account_id);
CREATE TABLE marketplace_profile_challenges (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 peer_id TEXT NOT NULL,
 public_key TEXT NOT NULL,
 challenge_text TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 used_token TEXT
);
CREATE INDEX marketplace_profile_challenge_account ON marketplace_profile_challenges(account_id,expires_at);
