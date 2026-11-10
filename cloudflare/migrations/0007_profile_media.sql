CREATE TABLE account_profile_media (
  account_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  manifest TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('writing','ready','deleting')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(account_id, revision)
);
CREATE INDEX account_profile_media_cleanup ON account_profile_media(state, created_at);
CREATE TABLE profile_media_maintenance (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  cursor TEXT
);
INSERT INTO profile_media_maintenance (id, cursor) VALUES (1, NULL);
