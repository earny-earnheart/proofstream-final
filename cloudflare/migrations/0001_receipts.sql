-- Receipts issued by the proofstream-web Worker.
-- PLACEHOLDER: database_id in wrangler.jsonc is 00000000-0000-0000-0000-000000000000.
-- Replace that id after `wrangler d1 create proofstream-proofs`.
-- Do not create the remote database and do not apply this migration from CI.
-- Owner steps: docs/internal/receipts-plan.md

CREATE TABLE IF NOT EXISTS receipts (
  receipt_id TEXT PRIMARY KEY CHECK (length(receipt_id) = 36),
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  issued_at TEXT NOT NULL CHECK (length(issued_at) = 24),
  signature TEXT NOT NULL CHECK (length(signature) = 86),
  key_id TEXT NOT NULL CHECK (length(key_id) BETWEEN 1 AND 64),
  metadata TEXT NOT NULL CHECK (length(metadata) <= 512)
);

CREATE INDEX IF NOT EXISTS idx_receipts_fingerprint ON receipts (fingerprint);
CREATE INDEX IF NOT EXISTS idx_receipts_issued_at ON receipts (issued_at);
