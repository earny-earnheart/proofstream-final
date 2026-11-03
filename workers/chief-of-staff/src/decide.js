// Human decision on a Tier 3 item: Approve -> state "done", Reject -> state
// "rejected". Writes an approvals row bound to the exact item_opened payload
// hash, plus an item_resolved ledger event. Only the dashboard (DASH_TOKEN)
// can call this; ingest tokens cannot.
import { appendEvent } from "./ledger.js";
import { HttpError, ID_RE, TERMINAL_EVENTS, current, projectOne } from "./ingest.js";

const DECISIONS = { approve: "done", reject: "rejected" };

export async function decideItem(db, body) {
  const { item_id, decision } = body || {};
  if (typeof item_id !== "string" || !ID_RE.test(item_id)) throw new HttpError(422, "item_id required");
  if (!(decision in DECISIONS)) throw new HttpError(422, 'decision must be "approve" or "reject"');
  const note = body.note == null ? null : String(body.note).slice(0, 1000);

  const q = await db.prepare(`SELECT * FROM queue WHERE item_id = ?`).bind(item_id).first();
  if (!q) throw new HttpError(404, `no item ${item_id}`);
  if (!["open", "escalated"].includes(q.state)) return { status: 200, body: await current(db, item_id, true) };
  if (q.tier !== 3) throw new HttpError(409, "only Tier 3 items take an Approve/Reject decision");

  const quar = await db.prepare(
    `SELECT reason FROM quarantine WHERE subject_type = 'queue_item' AND subject_id = ? AND released_at IS NULL`
  ).bind(item_id).first();
  if (quar && decision === "approve") {
    throw new HttpError(403, `quarantined (${quar.reason}); it can be rejected, not approved`);
  }

  const opened = await db.prepare(
    `SELECT payload_sha256 FROM ledger
      WHERE subject_type = 'queue_item' AND subject_id = ? AND event_type = 'item_opened'
      ORDER BY seq ASC LIMIT 1`
  ).bind(item_id).first();
  if (!opened) throw new HttpError(500, "item has no item_opened event");

  // The dashboard token is single-holder: the principal.
  const principal = await db.prepare(
    `SELECT holder_identity FROM roles WHERE role_id = 'principal' AND superseded_at IS NULL`
  ).first();
  const approver = principal?.holder_identity ?? "principal";
  const ts = new Date().toISOString();
  const approval_id = `appr:${item_id}`.slice(0, 160);
  const state = DECISIONS[decision];

  const ev = await appendEvent(db, {
    domain: q.domain,
    event_type: "item_resolved",
    subject_type: "queue_item",
    subject_id: item_id,
    actor: "human",
    actor_identity: approver,
    payload: {
      state, resolved_at: ts, note, decision, approval_id,
      approved_payload_sha256: opened.payload_sha256,
    },
  }, { event_types: TERMINAL_EVENTS });
  if (ev.duplicate) return { status: 200, body: await current(db, item_id, true) };

  const proj = await projectOne(db, item_id);
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO approvals (approval_id, item_id, payload_sha256, approver_role,
         approver_identity, signature, ts) VALUES (?, ?, ?, 'principal', ?, NULL, ?)`
    ).bind(approval_id, item_id, opened.payload_sha256, approver, ts),
    proj.stmt,
  ]);
  return { status: 200, body: { item_id, decision, state, seq: ev.seq, approval_id, approver } };
}
