// Append-only, hash-chained ledger. Unchanged from the deployed version
// (recovered from the live bundle on 2026-11-03): changing the hash input
// would break verification of every existing row.

export const GENESIS_PREV = "0".repeat(64);

export async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function rowHashInput(r) {
  return JSON.stringify([
    r.prev_hash,
    r.ts,
    r.domain,
    r.event_type,
    r.subject_type,
    r.subject_id,
    r.actor,
    r.actor_identity ?? null,
    r.payload_sha256,
  ]);
}

// Exposed for the compatibility test against real production rows.
export const rowHash = (r) => sha256hex(rowHashInput(r));

async function buildRow(ev, prevHash) {
  const payload_json = JSON.stringify(ev.payload ?? {});
  const row = {
    ts: ev.ts || new Date().toISOString(),
    domain: ev.domain,
    event_type: ev.event_type,
    subject_type: ev.subject_type,
    subject_id: ev.subject_id,
    actor: ev.actor,
    actor_identity: ev.actor_identity ?? null,
    payload_json,
    payload_sha256: await sha256hex(payload_json),
    prev_hash: prevHash,
  };
  row.row_hash = await sha256hex(rowHashInput(row));
  return row;
}

const COLS = [
  "ts", "domain", "event_type", "subject_type", "subject_id", "actor",
  "actor_identity", "payload_json", "payload_sha256", "prev_hash", "row_hash",
];

// Appends one event. The INSERT only lands if the head has not moved since we
// read it (optimistic concurrency). `unless` makes it idempotent: skip if the
// subject already has one of the listed event types.
export async function appendEvent(db, ev, unless = null) {
  const guardSql = unless
    ? ` AND NOT EXISTS (SELECT 1 FROM ledger WHERE subject_type = ? AND subject_id = ?
           AND event_type IN (${unless.event_types.map(() => "?").join(", ")}))`
    : "";
  const guardBinds = unless ? [ev.subject_type, ev.subject_id, ...unless.event_types] : [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await db.prepare(
      `SELECT seq, row_hash FROM ledger ORDER BY seq DESC LIMIT 1`
    ).first();
    const headSeq = head ? head.seq : 0;
    const row = await buildRow(ev, head ? head.row_hash : GENESIS_PREV);
    const res = await db.prepare(
      `INSERT INTO ledger (${COLS.join(", ")})
       SELECT ${COLS.map(() => "?").join(", ")}
        WHERE COALESCE((SELECT MAX(seq) FROM ledger), 0) = ?${guardSql}`
    ).bind(...COLS.map((c) => row[c]), headSeq, ...guardBinds).run();
    if (res.meta.changes === 1) return { seq: res.meta.last_row_id, row_hash: row.row_hash };
    if (unless) {
      const dup = await db.prepare(
        `SELECT seq FROM ledger WHERE subject_type = ? AND subject_id = ?
           AND event_type IN (${unless.event_types.map(() => "?").join(", ")}) LIMIT 1`
      ).bind(...guardBinds).first();
      if (dup) return { duplicate: true, seq: dup.seq };
    }
  }
  throw new Error("ledger append lost the race 3 times");
}

export async function verifyChain(db) {
  const { results } = await db.prepare(
    `SELECT seq, ts, domain, event_type, subject_type, subject_id, actor,
            actor_identity, payload_json, payload_sha256, prev_hash, row_hash
       FROM ledger ORDER BY seq ASC`
  ).all();
  if (!results.length) return { ok: true, rows: 0, note: "empty ledger" };
  let prev = GENESIS_PREV;
  for (const r of results) {
    const fail = (reason) => ({ ok: false, rows: results.length, broken_at_seq: r.seq, reason });
    if (r.prev_hash !== prev) return fail("prev_hash does not link to previous row");
    if ((await sha256hex(r.payload_json)) !== r.payload_sha256) return fail("payload_sha256 mismatch");
    if ((await sha256hex(rowHashInput(r))) !== r.row_hash) return fail("row_hash mismatch");
    prev = r.row_hash;
  }
  return { ok: true, rows: results.length, head: prev };
}
