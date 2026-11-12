-- Aggregate product events only; no conversations, member lists or account identifiers.
CREATE TABLE marketplace_metrics (
 day TEXT NOT NULL, event TEXT NOT NULL, item_id TEXT NOT NULL,
 count INTEGER NOT NULL DEFAULT 0 CHECK(count>=0), PRIMARY KEY(day,event,item_id)
);
