-- Daily-ops wiring: three projection columns on the queue.
-- The queue is a projection of the ledger (nightly rebuild repairs it), so
-- these are derived values, filled from each item_opened payload.
--   org        proofstream | earnheart | pantheon (NULL for legacy channel items)
--   source     morning_brief | jira | health | deploy | manual
--   ref_url    link back to the originating page/issue/site
-- Policy rows for the new task types are NOT inserted here: the Worker adds
-- them itself and records a policy_changed ledger event in the same step,
-- so the hash chain keeps a record of every policy change.
ALTER TABLE queue ADD COLUMN org TEXT;
ALTER TABLE queue ADD COLUMN source TEXT;
ALTER TABLE queue ADD COLUMN ref_url TEXT;
CREATE INDEX idx_queue_source_open ON queue (source, state);
