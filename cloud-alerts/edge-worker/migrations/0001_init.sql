-- Phase 49: isolated Cloudflare D1 database. No broker orders or simulated fills.
-- Do not migrate the existing Python SQLite journal into this database until
-- reconciliation/accounting invariants are separately ported and validated.
CREATE TABLE IF NOT EXISTS relay_nonces (
  nonce TEXT PRIMARY KEY NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS token_vault (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  iv TEXT NOT NULL,
  cipher TEXT NOT NULL,
  relay_ts INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS edge_heartbeat (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  timestamp_ms INTEGER NOT NULL,
  phase TEXT NOT NULL
);
