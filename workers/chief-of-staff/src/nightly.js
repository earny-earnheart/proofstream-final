// Nightly integrity pass: verify the hash chain, then rebuild the queue table
// from the ledger (the ledger is the source of truth; the queue is a view).
import { appendEvent, verifyChain } from "./ledger.js";

export const QUEUE_COLS = [
  "item_id", "domain", "task", "tier", "tier_reason", "owner_role",
  "created_at", "deadline", "escalation_path", "escalation_idx", "state",
  "resolved_at", "last_seq", "org", "source", "ref_url",
];

export function projectQueue(events) {
  const items = new Map();
  for (const e of events) {
    const p = JSON.parse(e.payload_json);
    const id = e.subject_id;
    if (e.event_type === "item_opened") {
      items.set(id, {
        item_id: id,
        domain: p.domain ?? e.domain,
        task: p.task,
        tier: p.tier,
        tier_reason: p.tier_reason,
        owner_role: p.owner_role,
        created_at: p.created_at ?? e.ts,
        deadline: p.deadline,
        escalation_path: typeof p.escalation_path === "string"
          ? p.escalation_path
          : JSON.stringify(p.escalation_path ?? []),
        escalation_idx: 0,
        state: "open",
        resolved_at: null,
        last_seq: e.seq,
        org: p.org ?? null,
        source: p.source ?? null,
        ref_url: p.ref_url ?? null,
      });
      continue;
    }
    const it = items.get(id);
    if (!it) continue;
    if (e.event_type === "item_escalated") {
      it.escalation_idx = p.escalation_idx ?? it.escalation_idx + 1;
      it.state = "escalated";
    } else if (e.event_type === "item_resolved") {
      it.state = p.state;
      it.resolved_at = p.resolved_at ?? e.ts;
    } else if (e.event_type === "item_failed_closed") {
      it.state = "failed_closed";
      it.resolved_at = p.resolved_at ?? e.ts;
    } else {
      continue;
    }
    it.last_seq = e.seq;
  }
  return items;
}

const same = (a, b) => QUEUE_COLS.every((c) => (a[c] ?? null) === (b[c] ?? null));

export function upsertQueueStmt(db, row) {
  return db.prepare(
    `INSERT INTO queue (${QUEUE_COLS.join(", ")})
     VALUES (${QUEUE_COLS.map(() => "?").join(", ")})
     ON CONFLICT(item_id) DO UPDATE SET
     ${QUEUE_COLS.slice(1).map((c) => `${c} = excluded.${c}`).join(", ")}`
  ).bind(...QUEUE_COLS.map((c) => row[c] ?? null));
}

export async function rebuildQueue(db) {
  const events = (await db.prepare(
    `SELECT seq, ts, domain, event_type, subject_id, payload_json
       FROM ledger WHERE subject_type = 'queue_item' ORDER BY seq ASC`
  ).all()).results;
  const projected = projectQueue(events);
  const current = new Map((await db.prepare(
    `SELECT ${QUEUE_COLS.join(", ")} FROM queue`
  ).all()).results.map((r) => [r.item_id, r]));
  const repaired = [];
  const stmts = [];
  for (const [id, want] of projected) {
    const have = current.get(id);
    if (have && same(have, want)) continue;
    repaired.push(id);
    stmts.push(upsertQueueStmt(db, want));
  }
  if (stmts.length) await db.batch(stmts);
  const orphans = [...current.keys()].filter((id) => !projected.has(id));
  return { events: events.length, projected: projected.size, repaired, orphans };
}

export async function runNightly(env, { cron = "manual" } = {}) {
  const chain = await verifyChain(env.DB);
  const queue = chain.ok ? await rebuildQueue(env.DB) : { skipped: "chain verification failed" };
  if (chain.rows === 0) return { chain, queue, recorded: false };
  const ok = chain.ok && !queue.orphans?.length;
  const rec = await appendEvent(env.DB, {
    domain: "core",
    event_type: chain.ok ? "nightly_check" : "chain_broken",
    subject_type: "system",
    subject_id: "chief-of-staff",
    actor: "system",
    actor_identity: `scheduler:${cron}`,
    payload: { ok, chain, queue },
  });
  return { chain, queue, recorded: rec.seq };
}
