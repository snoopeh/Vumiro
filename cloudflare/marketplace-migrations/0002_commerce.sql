-- Dedicated marketplace D1 database; all amounts are integer minor units.
CREATE TABLE IF NOT EXISTS marketplace_provider_accounts (
 account_id TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'stripe', provider_account_id TEXT NOT NULL UNIQUE,
 verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)), mode TEXT NOT NULL CHECK(mode='sandbox'), updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS marketplace_orders (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, item_id TEXT NOT NULL, creator_id TEXT NOT NULL,
 version_id TEXT NOT NULL, title TEXT NOT NULL, price_minor INTEGER NOT NULL CHECK(price_minor>0), currency TEXT NOT NULL,
 terms_version TEXT NOT NULL, terms_accepted_at INTEGER NOT NULL, provider TEXT NOT NULL DEFAULT 'stripe', mode TEXT NOT NULL CHECK(mode='sandbox'),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','refunded','disputed')),
 session_id TEXT UNIQUE, payment_intent_id TEXT, charge_id TEXT, transfer_id TEXT UNIQUE,
 gross_minor INTEGER NOT NULL DEFAULT 0, tax_minor INTEGER NOT NULL DEFAULT 0, refund_minor INTEGER NOT NULL DEFAULT 0,
 processing_minor INTEGER NOT NULL DEFAULT 0, disputed INTEGER NOT NULL DEFAULT 0,
 dispute_id TEXT, dispute_status TEXT NOT NULL DEFAULT 'none',
 settled INTEGER NOT NULL DEFAULT 0, creator_minor INTEGER NOT NULL DEFAULT 0, vumiro_minor INTEGER NOT NULL DEFAULT 0,
 transferred_minor INTEGER NOT NULL DEFAULT 0, recovered_minor INTEGER NOT NULL DEFAULT 0,
 payout_status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
ALTER TABLE marketplace_entitlements ADD COLUMN order_id TEXT REFERENCES marketplace_orders(id);
CREATE INDEX IF NOT EXISTS marketplace_orders_creator ON marketplace_orders(creator_id,created_at);
CREATE INDEX IF NOT EXISTS marketplace_orders_buyer ON marketplace_orders(account_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_orders_one_pending ON marketplace_orders(account_id,item_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS marketplace_ledger (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES marketplace_orders(id), kind TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer'), currency TEXT NOT NULL,
 provider_reference TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS marketplace_ledger_order ON marketplace_ledger(order_id,kind);
CREATE TRIGGER IF NOT EXISTS marketplace_ledger_no_update BEFORE UPDATE ON marketplace_ledger BEGIN SELECT RAISE(ABORT,'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS marketplace_ledger_no_delete BEFORE DELETE ON marketplace_ledger BEGIN SELECT RAISE(ABORT,'ledger is append-only'); END;
CREATE TABLE IF NOT EXISTS marketplace_payment_events (
 provider TEXT NOT NULL, event_id TEXT NOT NULL, event_type TEXT NOT NULL, order_id TEXT,
 status TEXT NOT NULL CHECK(status IN ('processing','processed','ignored')), created_at INTEGER NOT NULL, processed_at INTEGER,
 PRIMARY KEY(provider,event_id)
);
CREATE TABLE IF NOT EXISTS marketplace_refund_requests (
 order_id TEXT PRIMARY KEY REFERENCES marketplace_orders(id), account_id TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('requested','approved','rejected')), resolution TEXT,
 provider_refund_id TEXT, resolved_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
-- Persist exact provider mutation parameters before HTTP. One unfinished money operation per order.
CREATE TABLE IF NOT EXISTS marketplace_provider_operations (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES marketplace_orders(id), kind TEXT NOT NULL,
 target_minor INTEGER NOT NULL, amount_minor INTEGER NOT NULL, payload TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('processing','completed')), provider_reference TEXT, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_one_money_operation ON marketplace_provider_operations(order_id) WHERE status='processing';
CREATE TABLE IF NOT EXISTS marketplace_commerce_metric_events (
 order_id TEXT NOT NULL, event TEXT NOT NULL, PRIMARY KEY(order_id,event)
);
