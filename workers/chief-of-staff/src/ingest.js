// Intake: open / resolve queue items. Every write is a ledger event first; the
// queue row is a projection of it.
import { appendEvent } from "./ledger.js";
import { projectQueue, upsertQueueStmt } from "./nightly.js";
import { ORGS, policyMap } from "./policy.js";

// required = gates the caller must report (missing -> 422, fail closed).
// org_required = item must say which business it belongs to.
export const TASKS = {
  lead_discover: {
    domain: "channel",
    owner_role: "channel_lead",
    required: [
      "gate.channel.source_compliance",
      "gate.channel.pii_scope",
      "gate.shared.restricted_molecule",
    ],
    org_required: false,
  },
  brief_item: { domain: "ops", owner_role: "principal", required: ["gate.ops.needs_decision"], org_required: true },
  jira_task: { domain: "ops", owner_role: "principal", required: ["gate.ops.needs_decision"], org_required: true },
  notion_task: { domain: "ops", owner_role: "principal", required: ["gate.ops.needs_decision"], org_required: true },
  deploy_record: { domain: "ops", owner_role: "operator", required: ["gate.ops.health"], org_required: true },
  health_check: { domain: "ops", owner_role: "operator", required: ["gate.ops.health"], org_required: true },
};

export const SOURCES = ["morning_brief", "jira", "health", "deploy", "manual"];
const OPEN_STATES = ["open", "escalated"];
const RESOLVE_STATES = ["done", "rejected", "abandoned"];
export const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
export const TERMINAL_EVENTS = ["item_resolved", "item_failed_closed"];

export class HttpError extends Error {
  constructor(status, msg, extra = {}) {
    super(msg);
    this.status = status;
    this.extra = extra;
  }
}
const bad = (msg, extra) => {
  throw new HttpError(422, msg, extra);
};

function evaluateGates(spec, verdicts, policy, scanText) {
  if (!Array.isArray(verdicts)) bad("verdicts must be an array of { gate, verdict }");
  const seen = new Map();
  for (const v of verdicts) {
    if (!v || typeof v.gate !== "string" || typeof v.verdict !== "string") {
      bad("each verdict needs string gate and verdict");
    }
    const g = policy[v.gate];
    if (!v.gate.startsWith("gate.") || !g) bad(`unknown gate ${v.gate}`);
    if (!(v.verdict in g.verdicts)) {
      bad(`verdict "${v.verdict}" not allowed for ${v.gate}`, { allowed: Object.keys(g.verdicts) });
    }
    if (seen.has(v.gate)) bad(`gate ${v.gate} reported twice`);
    seen.set(v.gate, { ...v });
  }
  const missing = spec.required.filter((g) => !seen.has(g));
  if (missing.length) bad("required gates missing (fail closed)", { missing });
  // Server-side override (policy: all_channels): a restricted molecule
  // anywhere in the text forces the restricted verdict on every task type,
  // whatever the caller claimed.
  const rm = policy["gate.shared.restricted_molecule"];
  const hit = (rm?.molecules || []).find((m) => scanText.includes(m.toLowerCase()));
  if (hit && seen.get("gate.shared.restricted_molecule")?.verdict !== "restricted") {
    seen.set("gate.shared.restricted_molecule", {
      gate: "gate.shared.restricted_molecule",
      verdict: "restricted",
      dimension: `server_override:${hit}`,
    });
  }
  const scored = [...seen.values()].map((v) => ({ ...v, tier_implied: policy[v.gate].verdicts[v.verdict] }));
  const hardStops = scored.filter((v) => policy[v.gate].hard_stop === v.verdict);
  return { scored, hardStops };
}

export async function projectOne(db, itemId) {
  const events = (await db.prepare(
    `SELECT seq, ts, domain, event_type, subject_id, payload_json
       FROM ledger WHERE subject_type = 'queue_item' AND subject_id = ? ORDER BY seq ASC`
  ).bind(itemId).all()).results;
  const it = projectQueue(events).get(itemId);
  if (!it) return null;
  return { row: it, stmt: upsertQueueStmt(db, it) };
}

async function escalationPath(db, ownerRole) {
  const roles = Object.fromEntries((await db.prepare(
    `SELECT role_id, holder_identity, alternate_identity FROM roles WHERE superseded_at IS NULL`
  ).all()).results.map((r) => [r.role_id, r]));
  const owner = roles[ownerRole];
  if (!owner) throw new HttpError(500, `owner role ${ownerRole} has no current holder`);
  const path = [
    { role: ownerRole, identity: owner.holder_identity },
    owner.alternate_identity && { role: `${ownerRole}.alternate`, identity: owner.alternate_identity },
    roles.principal && { role: "principal", identity: roles.principal.holder_identity },
  ].filter(Boolean);
  return path.filter((p, i) => path.findIndex((q) => q.identity === p.identity) === i);
}

const plusMs = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

function checkUrl(u) {
  if (u == null) return null;
  if (typeof u !== "string" || u.length > 500) bad("ref_url: string up to 500 chars");
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    bad("ref_url must be an absolute URL");
  }
  if (parsed.protocol !== "https:") bad("ref_url must be https");
  return parsed.toString();
}

export async function openItem(db, body) {
  const { task, title, actor_identity } = body;
  const spec = TASKS[task];
  if (!spec) bad(`task "${task}" is not accepted by ingest yet`, { accepted: Object.keys(TASKS) });
  if (typeof title !== "string" || !title.trim() || title.length > 500) bad("title: 1-500 chars");
  if (typeof actor_identity !== "string" || !actor_identity.trim()) bad("actor_identity required");
  const item_id = body.item_id ?? `${task}:${crypto.randomUUID()}`;
  if (typeof item_id !== "string" || !ID_RE.test(item_id)) bad("item_id: 1-128 chars of A-Z a-z 0-9 . _ : -");

  // Data-structure QC for the daily-ops fields.
  const org = body.org ?? null;
  if (org !== null && !ORGS.includes(org)) bad(`org must be one of ${ORGS.join(", ")}`);
  if (spec.org_required && org === null) bad(`org required for ${task}`, { allowed: ORGS });
  const source = body.source ?? (spec.domain === "ops" ? "manual" : null);
  if (source !== null && !SOURCES.includes(source)) bad(`source must be one of ${SOURCES.join(", ")}`);
  const ref_url = checkUrl(body.ref_url);

  const detail = body.payload ?? {};
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) bad("payload must be an object");
  if (JSON.stringify(detail).length > 16384) bad("payload over 16 KB");

  const policy = await policyMap(db);
  const hold = policy["core.sequencing_hold"]?.[task];
  if (hold) throw new HttpError(409, `task ${task} is on sequencing hold: ${hold}`);
  const map = policy[`tier_map.${spec.domain}.${task}`];
  if (!map) throw new HttpError(500, `no tier_map for ${task}`);
  const scanText = JSON.stringify([title, detail]).toLowerCase();
  const { scored, hardStops } = evaluateGates(spec, body.verdicts, policy, scanText);
  const tier = Math.max(map.tier, ...scored.map((v) => v.tier_implied));
  const drivers = scored
    .filter((v) => v.tier_implied === tier && tier > map.tier)
    .map((v) => `${v.gate.split(".").pop()}=${v.verdict}`);
  const tier_reason = `${task}: tier_map ${map.tier}` + (drivers.length ? `; raised to ${tier} by ${drivers.join(", ")}` : "");
  const created_at = new Date().toISOString();
  const t = policy["core.escalation_timeouts"] || { tier3_first_hours: 24 };
  let deadline;
  if (tier === 3) deadline = plusMs(created_at, t.tier3_first_hours * 36e5);
  else if (body.deadline) {
    if (!(Date.parse(body.deadline) > Date.now())) bad("deadline must be a future ISO timestamp");
    deadline = new Date(body.deadline).toISOString();
  } else deadline = plusMs(created_at, 24 * 36e5);
  const escalation_path = await escalationPath(db, spec.owner_role);

  const opened = await appendEvent(db, {
    domain: spec.domain,
    event_type: "item_opened",
    subject_type: "queue_item",
    subject_id: item_id,
    actor: "agent",
    actor_identity,
    payload: {
      domain: spec.domain,
      task: title.trim(),
      task_type: task,
      tier,
      tier_reason,
      owner_role: spec.owner_role,
      created_at,
      deadline,
      escalation_path,
      verdicts: scored,
      detail,
      // Only written when set, so legacy-shaped payloads stay byte-identical.
      ...(org ? { org } : {}),
      ...(source ? { source } : {}),
      ...(ref_url ? { ref_url } : {}),
    },
  }, { event_types: ["item_opened"] });
  if (opened.duplicate) return { status: 200, body: await current(db, item_id, true) };

  const stmts = scored.map((v) => db.prepare(
    `INSERT OR IGNORE INTO gate_verdicts (id, item_id, gate, verdict, dimension, tier_implied, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(`${item_id}|${v.gate}`, item_id, v.gate, v.verdict, v.dimension ?? null, v.tier_implied, created_at));

  let quarantined = false;
  if (hardStops.length) {
    const reason = "hard stop: " + hardStops.map((v) => `${v.gate}=${v.verdict}`).join(", ");
    await appendEvent(db, {
      domain: spec.domain,
      event_type: "item_quarantined",
      subject_type: "queue_item",
      subject_id: item_id,
      actor: "system",
      actor_identity: "ingest",
      payload: { reason },
    }, { event_types: ["item_quarantined"] });
    stmts.push(db.prepare(
      `INSERT OR IGNORE INTO quarantine (q_id, domain, subject_type, subject_id, reason, entered_at)
       VALUES (?, ?, 'queue_item', ?, ?, ?)`
    ).bind(`q:${item_id}`, spec.domain, item_id, reason, created_at));
    quarantined = true;
  }
  // Reversal windows only for actions that can actually be reversed (the
  // tier_map names how). Health/brief items have nothing to undo.
  if (tier === 2 && map.reversal) {
    const mins = policy["core.reversal_window"]?.tier2_minutes ?? 240;
    stmts.push(db.prepare(
      `INSERT OR IGNORE INTO reversals (reversal_id, item_id, window_closes_at, state, ts)
       VALUES (?, ?, ?, 'open', ?)`
    ).bind(`rev:${item_id}`, item_id, plusMs(created_at, mins * 6e4), created_at));
  }
  const proj = await projectOne(db, item_id);
  stmts.push(proj.stmt);
  await db.batch(stmts);
  return {
    status: 201,
    body: {
      item_id, seq: opened.seq, row_hash: opened.row_hash, duplicate: false,
      tier, tier_reason, state: proj.row.state, deadline, owner_role: spec.owner_role,
      escalation_path, quarantined, verdicts: scored, org, source, ref_url,
    },
  };
}

export async function current(db, item_id, duplicate) {
  const q = await db.prepare(
    `SELECT item_id, task, tier, tier_reason, state, deadline, resolved_at, last_seq, org, source
       FROM queue WHERE item_id = ?`
  ).bind(item_id).first();
  return { duplicate, ...(q || { item_id, note: "in ledger; queue row pending nightly rebuild" }) };
}

export async function resolveItem(db, body) {
  const { item_id, state, actor_identity } = body;
  if (typeof item_id !== "string" || !ID_RE.test(item_id)) bad("item_id required");
  if (!RESOLVE_STATES.includes(state)) bad(`state must be one of ${RESOLVE_STATES.join(", ")}`);
  if (typeof actor_identity !== "string" || !actor_identity.trim()) bad("actor_identity required");
  const note = body.note == null ? null : String(body.note).slice(0, 1000);
  const q = await db.prepare(`SELECT * FROM queue WHERE item_id = ?`).bind(item_id).first();
  if (!q) throw new HttpError(404, `no open item ${item_id}`);
  if (!OPEN_STATES.includes(q.state)) return { status: 200, body: await current(db, item_id, true) };
  if (q.tier >= 3) throw new HttpError(403, "tier 3 items are resolved by a human approval, not ingest");
  const quar = await db.prepare(
    `SELECT 1 FROM quarantine WHERE subject_type = 'queue_item' AND subject_id = ? AND released_at IS NULL`
  ).bind(item_id).first();
  if (quar) throw new HttpError(403, "item is quarantined");
  const resolved_at = new Date().toISOString();
  const ev = await appendEvent(db, {
    domain: q.domain,
    event_type: "item_resolved",
    subject_type: "queue_item",
    subject_id: item_id,
    actor: "agent",
    actor_identity,
    payload: { state, resolved_at, note },
  }, { event_types: TERMINAL_EVENTS });
  if (ev.duplicate) return { status: 200, body: await current(db, item_id, true) };
  const proj = await projectOne(db, item_id);
  await proj.stmt.run();
  return { status: 200, body: { item_id, seq: ev.seq, row_hash: ev.row_hash, duplicate: false, state: proj.row.state, resolved_at } };
}

function tokenOk(given, want) {
  if (!want || typeof given !== "string" || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
export { tokenOk };

export function ingestAuthorized(request, env) {
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return tokenOk(bearer, env.INGEST_TOKEN);
}

export const reply = (d, s = 200) => new Response(JSON.stringify(d, null, 2), {
  status: s,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

export async function handleIngest(request, env) {
  if (!env.INGEST_TOKEN) return reply({ error: "ingest disabled: INGEST_TOKEN not set" }, 503);
  if (!ingestAuthorized(request, env)) return reply({ error: "unauthorized" }, 401);
  if (request.method !== "POST") return reply({ error: "POST only" }, 405);
  const raw = await request.text();
  if (raw.length > 65536) return reply({ error: "body over 64 KB" }, 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply({ error: "body must be JSON" }, 400);
  }
  try {
    const r = body.action === "open" ? await openItem(env.DB, body)
      : body.action === "resolve" ? await resolveItem(env.DB, body)
      : bad('action must be "open" or "resolve"');
    return reply(r.body, r.status);
  } catch (e) {
    if (e instanceof HttpError) return reply({ error: e.message, ...e.extra }, e.status);
    console.error("ingest failure", e?.stack || e);
    return reply({ error: "internal error" }, 500);
  }
}
