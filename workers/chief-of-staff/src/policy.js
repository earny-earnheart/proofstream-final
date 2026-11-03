// Policy rows for the daily-ops task types. Installed by the Worker (not by a
// SQL migration) so that the install is recorded as a policy_changed ledger
// event, as the genesis record requires for every policy change.
import { appendEvent, sha256hex } from "./ledger.js";

export const ORGS = ["proofstream", "earnheart", "pantheon"];

const RATIONALE =
  "Daily-ops wiring (2026-11-03): Morning Brief, Jira, deploy and health-check items on the dashboard";

// key -> value. All unlocked so they can be tuned later by versioning.
export const OPS_POLICY = {
  // "Does this need the principal?" no = routine, attention = look today,
  // yes = a decision only a human can make (Tier 3, Approve/Reject).
  "gate.ops.needs_decision": { verdicts: { no: 1, attention: 2, yes: 3 } },
  // Site/deploy health. Failures are Tier 2 (loud, amber) rather than Tier 3,
  // because they clear themselves when the next check passes.
  "gate.ops.health": { verdicts: { pass: 1, warn: 2, fail: 2 } },
  "tier_map.ops.brief_item": { tier: 1 },
  "tier_map.ops.jira_task": { tier: 1 },
  "tier_map.ops.notion_task": { tier: 1 },
  "tier_map.ops.deploy_record": { tier: 1 },
  "tier_map.ops.health_check": { tier: 1 },
};

export async function policyMap(db) {
  const { results } = await db.prepare(
    `SELECT key, value_json FROM policy WHERE superseded_at IS NULL`
  ).all();
  return Object.fromEntries(results.map((r) => [r.key, JSON.parse(r.value_json)]));
}

// Idempotent. Returns the keys it installed (empty when already present).
export async function ensureOpsPolicy(db) {
  const have = await policyMap(db);
  const missing = Object.keys(OPS_POLICY).filter((k) => !have[k]);
  if (!missing.length) return { installed: [] };

  const principal = await db.prepare(
    `SELECT holder_identity FROM roles WHERE role_id = 'principal' AND superseded_at IS NULL`
  ).first();
  const changedBy = principal?.holder_identity ?? "principal";
  const now = new Date().toISOString();
  const rows = missing.map((key) => ({
    policy_id: key,
    version: 1,
    key,
    value_json: JSON.stringify(OPS_POLICY[key]),
    locked: 0,
    effective_from: now,
    changed_by_identity: changedBy,
    change_rationale: RATIONALE,
  }));

  // Ledger first: if the inserts below fail, the next run logs and retries;
  // INSERT OR IGNORE on the (policy_id, version) key keeps it idempotent.
  await appendEvent(db, {
    domain: "core",
    event_type: "policy_changed",
    subject_type: "policy",
    subject_id: "ops-wiring-v1",
    actor: "system",
    actor_identity: "deploy:chief-of-staff-dash",
    payload: {
      change: "add",
      rows,
      rows_sha256: await sha256hex(JSON.stringify(rows)),
      rationale: RATIONALE,
    },
  });
  await db.batch(rows.map((r) => db.prepare(
    `INSERT OR IGNORE INTO policy (policy_id, version, key, value_json, locked,
       effective_from, changed_by_identity, change_rationale)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(r.policy_id, r.version, r.key, r.value_json, r.locked,
    r.effective_from, r.changed_by_identity, r.change_rationale)));
  return { installed: missing };
}
