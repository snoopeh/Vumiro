-- Separate database: never apply these migrations to ACCOUNT_DB.
PRAGMA foreign_keys = ON;
CREATE TABLE marketplace_creators (
 account_id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
 rights_accepted_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE marketplace_listings (
 id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES marketplace_creators(account_id),
 title TEXT NOT NULL, description TEXT NOT NULL, aesthetic TEXT NOT NULL DEFAULT 'community',
 status TEXT NOT NULL CHECK(status IN ('draft','published','delisted','disabled')),
 price_minor INTEGER NOT NULL DEFAULT 0 CHECK(price_minor >= 0), currency TEXT NOT NULL DEFAULT 'BRL',
 latest_version_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE marketplace_versions (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES marketplace_listings(id),
 version TEXT NOT NULL, asset_key TEXT NOT NULL UNIQUE, digest TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('submitted','approved','rejected','disabled')),
 rights_json TEXT NOT NULL, summary_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, reviewed_at INTEGER, review_reason TEXT,
 UNIQUE(item_id,version)
);
CREATE TABLE marketplace_listing_revisions (
 id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES marketplace_listings(id),creator_id TEXT NOT NULL,
 title TEXT NOT NULL,description TEXT NOT NULL,price_minor INTEGER NOT NULL CHECK(price_minor>=0),currency TEXT NOT NULL,aesthetic TEXT NOT NULL DEFAULT 'community',
 status TEXT NOT NULL CHECK(status IN ('submitted','approved','rejected')),created_at INTEGER NOT NULL,reviewed_at INTEGER,review_reason TEXT
);
CREATE TRIGGER marketplace_immutable_listing_revision BEFORE UPDATE OF id,item_id,creator_id,title,description,price_minor,currency,aesthetic,created_at ON marketplace_listing_revisions BEGIN SELECT RAISE(ABORT,'immutable-listing-revision'); END;
CREATE TRIGGER marketplace_immutable_version BEFORE UPDATE OF id,item_id,version,asset_key,digest,rights_json,summary_json,created_at ON marketplace_versions BEGIN SELECT RAISE(ABORT,'immutable-version'); END;
CREATE TABLE marketplace_entitlements (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, item_id TEXT NOT NULL REFERENCES marketplace_listings(id),
 status TEXT NOT NULL CHECK(status IN ('active','revoked')), source TEXT NOT NULL CHECK(source IN ('free','purchase')),
 created_at INTEGER NOT NULL, revoked_at INTEGER, UNIQUE(account_id,item_id)
);
CREATE TABLE marketplace_grants (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, item_id TEXT NOT NULL REFERENCES marketplace_listings(id), hub_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','grace','expired','withdrawn','revoked')),
 grace_until INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(account_id,item_id,hub_id),
 FOREIGN KEY(account_id,item_id) REFERENCES marketplace_entitlements(account_id,item_id)
);
CREATE INDEX marketplace_grants_hub ON marketplace_grants(hub_id,item_id,status,grace_until);
-- Triggers are the final authority even if simultaneous Workers observed the same count.
CREATE TRIGGER marketplace_slot_insert BEFORE INSERT ON marketplace_grants
 WHEN NEW.status='active' AND (SELECT count(*) FROM marketplace_grants WHERE account_id=NEW.account_id AND item_id=NEW.item_id AND (status='active' OR (status='grace' AND grace_until>NEW.updated_at))) >= 5
 BEGIN SELECT RAISE(ABORT,'marketplace-slot-limit'); END;
CREATE TRIGGER marketplace_slot_update BEFORE UPDATE OF status ON marketplace_grants
 WHEN NEW.status='active' AND NOT(OLD.status='active' OR (OLD.status='grace' AND OLD.grace_until>NEW.updated_at)) AND
 (SELECT count(*) FROM marketplace_grants WHERE account_id=NEW.account_id AND item_id=NEW.item_id AND id<>NEW.id AND (status='active' OR (status='grace' AND grace_until>NEW.updated_at))) >= 5
 BEGIN SELECT RAISE(ABORT,'marketplace-slot-limit'); END;
CREATE TABLE marketplace_theme_bindings (
 hub_id TEXT NOT NULL, scope_id TEXT NOT NULL, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('hub','space','text','voice')),
 item_id TEXT NOT NULL REFERENCES marketplace_listings(id), version_id TEXT NOT NULL REFERENCES marketplace_versions(id),
 overrides_json TEXT NOT NULL DEFAULT '{}', previous_json TEXT,
 applied_by TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(hub_id,scope_id)
);
CREATE TABLE marketplace_theme_reset_undo (hub_id TEXT NOT NULL,scope_id TEXT NOT NULL,configuration_json TEXT NOT NULL,PRIMARY KEY(hub_id,scope_id));
CREATE TABLE marketplace_membership_events (
 event_id TEXT PRIMARY KEY, root_hub_id TEXT NOT NULL, account_id TEXT NOT NULL, sequence INTEGER NOT NULL,
 member INTEGER NOT NULL CHECK(member IN (0,1)), occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
 UNIQUE(root_hub_id,account_id,sequence)
);
CREATE INDEX marketplace_event_sequence ON marketplace_membership_events(root_hub_id,account_id,sequence);
CREATE TABLE marketplace_reconciliation (id INTEGER PRIMARY KEY CHECK(id=1),cursor TEXT NOT NULL,updated_at INTEGER NOT NULL);
INSERT INTO marketplace_reconciliation(id,cursor,updated_at) VALUES(1,'',0);
CREATE TABLE marketplace_reports (id TEXT PRIMARY KEY,account_id TEXT NOT NULL,item_id TEXT NOT NULL REFERENCES marketplace_listings(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at INTEGER NOT NULL);
CREATE TABLE marketplace_appeals (id TEXT PRIMARY KEY,account_id TEXT NOT NULL,item_id TEXT NOT NULL REFERENCES marketplace_listings(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at INTEGER NOT NULL);
CREATE TABLE marketplace_audit (id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT NOT NULL,detail_json TEXT NOT NULL,created_at INTEGER NOT NULL);
