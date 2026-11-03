-- Production schema of the `chief-of-staff` D1 database as of 2026-11-03,
-- read from sqlite_master. Reference only: these tables already exist in
-- production and are NOT in migrations/ (re-running them would fail).
-- The test suite loads this file, then migrations/, to mirror production.

CREATE TABLE ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  domain TEXT NOT NULL,
  event_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_identity TEXT,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  row_hash TEXT NOT NULL
);
CREATE INDEX idx_ledger_domain_ts ON ledger(domain, ts);
CREATE INDEX idx_ledger_seq_desc ON ledger (seq DESC);
CREATE INDEX idx_ledger_subject ON ledger(subject_type, subject_id);

CREATE TABLE policy (
  policy_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  superseded_at TEXT,
  changed_by_identity TEXT NOT NULL,
  change_rationale TEXT NOT NULL,
  PRIMARY KEY (policy_id, version)
);
CREATE INDEX idx_policy_active ON policy (key) WHERE superseded_at IS NULL;
CREATE INDEX idx_policy_current ON policy(key, superseded_at);

CREATE TABLE roles (
  role_id TEXT PRIMARY KEY,
  domain TEXT,
  holder_identity TEXT NOT NULL,
  alternate_identity TEXT,
  conflicts_with TEXT,
  effective_from TEXT NOT NULL,
  superseded_at TEXT
);
CREATE INDEX idx_roles_active ON roles (role_id) WHERE superseded_at IS NULL;

CREATE TABLE queue (
  item_id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  task TEXT NOT NULL,
  tier INTEGER NOT NULL,
  tier_reason TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deadline TEXT NOT NULL,
  escalation_path TEXT NOT NULL,
  escalation_idx INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  resolved_at TEXT,
  last_seq INTEGER NOT NULL
);
CREATE INDEX idx_queue_aging ON queue(state, deadline);
CREATE INDEX idx_queue_state ON queue (state, tier DESC, deadline ASC);

CREATE TABLE gate_verdicts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  gate TEXT NOT NULL,
  verdict TEXT NOT NULL,
  dimension TEXT,
  tier_implied INTEGER NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX idx_gv_item ON gate_verdicts(item_id);

CREATE TABLE approvals (
  approval_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  approver_role TEXT NOT NULL,
  approver_identity TEXT NOT NULL,
  signature TEXT,
  ts TEXT NOT NULL,
  revoked_seq INTEGER
);
CREATE INDEX idx_approvals_item ON approvals(item_id);

CREATE TABLE quarantine (
  q_id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  entered_at TEXT NOT NULL,
  released_at TEXT,
  released_by_role TEXT,
  released_by_identity TEXT,
  release_rationale TEXT
);
CREATE INDEX idx_quarantine_open ON quarantine(released_at);

CREATE TABLE reversals (
  reversal_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  window_closes_at TEXT NOT NULL,
  state TEXT NOT NULL,
  exercised_by_identity TEXT,
  ts TEXT NOT NULL
);
CREATE INDEX idx_reversals_open ON reversals(state, window_closes_at);

CREATE TABLE adapter_state (
  domain TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (domain, key, seq)
);
