// Daily sync: pull each source, open new items, close items the source no
// longer lists, and record one source_sync snapshot event for the dashboard.
//
// Reconciliation rules (data QC):
// - A source is reconciled only when it was read successfully. A failed or
//   skipped source never closes anything.
// - Tier 3 items are never auto-closed; they wait for Approve/Reject.
// - Item ids are deterministic, so re-running the sync is idempotent.
import { appendEvent } from "./ledger.js";
import { HttpError, openItem, resolveItem } from "./ingest.js";
import { ensureOpsPolicy, ORGS } from "./policy.js";
import {
  briefToItems, checkTarget, chicagoDate, fetchBrief, fetchJira,
  jiraEnabled, jiraToItems, parseTargets,
} from "./sources.js";

const errText = (e) => (e instanceof HttpError ? `${e.status} ${e.message}` : String(e?.message || e)).slice(0, 200);

async function openItems(db, items, actor) {
  const res = { opened: 0, existing: 0, errors: [] };
  for (const it of items) {
    try {
      const r = await openItem(db, { ...it, actor_identity: actor });
      if (r.status === 201) res.opened++;
      else res.existing++;
    } catch (e) {
      res.errors.push({ item_id: it.item_id, error: errText(e) });
    }
  }
  return res;
}

async function openBySource(db, source, prefix = "") {
  return (await db.prepare(
    `SELECT item_id, tier FROM queue
      WHERE source = ? AND item_id LIKE ? AND state IN ('open','escalated')`
  ).bind(source, `${prefix}%`).all()).results;
}

// Close open items from `source` whose ids are not in `keepIds`.
async function reconcile(db, source, keepIds, actor, note) {
  const res = { resolved: 0, held_tier3: 0, errors: [] };
  for (const q of await openBySource(db, source)) {
    if (keepIds.has(q.item_id)) continue;
    if (q.tier >= 3) {
      res.held_tier3++;
      continue;
    }
    try {
      await resolveItem(db, { item_id: q.item_id, state: "done", actor_identity: actor, note });
      res.resolved++;
    } catch (e) {
      res.errors.push({ item_id: q.item_id, error: errText(e) });
    }
  }
  return res;
}

async function syncHealth(db, env, fetcher, date) {
  let targets;
  try {
    targets = parseTargets(env.HEALTH_TARGETS);
  } catch (e) {
    return { ok: false, reason: `HEALTH_TARGETS invalid: ${errText(e)}` };
  }
  const results = await Promise.all(targets.map((t) => checkTarget(fetcher, t)));
  const out = { ok: true, results, opened: 0, resolved: 0, errors: [] };
  for (const r of results) {
    const open = await openBySource(db, "health", `health:${r.name}:`);
    if (r.verdict === "pass") {
      for (const q of open) {
        try {
          await resolveItem(db, {
            item_id: q.item_id, state: "done", actor_identity: "sync:health",
            note: `check passed (HTTP ${r.status})`,
          });
          out.resolved++;
        } catch (e) {
          out.errors.push({ item_id: q.item_id, error: errText(e) });
        }
      }
    } else if (!open.length) {
      const host = new URL(r.url).host;
      const what = r.verdict === "warn" ? "needs attention" : "is down";
      const detail = r.note || (r.status ? `HTTP ${r.status}` : "no response");
      const o = await openItems(db, [{
        // One item per outage episode: a new failure after recovery gets a
        // new id (a reused id could not reopen; ids are open-once).
        item_id: `health:${r.name}:${Date.now()}`,
        task: "health_check",
        title: `${host} ${what}: ${detail}`,
        org: r.org,
        source: "health",
        ref_url: r.url,
        verdicts: [{ gate: "gate.ops.health", verdict: r.verdict }],
        payload: { status: r.status, ms: r.ms, note: r.note ?? null },
      }], "sync:health");
      out.opened += o.opened;
      out.errors.push(...o.errors);
    }
  }
  return out;
}

async function syncBrief(db, env, fetcher, date) {
  const b = await fetchBrief(env, fetcher, date);
  if (!b.ok) return { ok: false, skipped: !!b.skipped, reason: b.reason };
  const items = await briefToItems({
    pageUrl: b.page_url,
    topPriority: b.top_priority,
    sections: b.sections,
    skipJiraKeys: jiraEnabled(env),
  });
  const o = await openItems(db, items, "sync:morning_brief");
  const rec = await reconcile(db, "morning_brief", new Set(items.map((i) => i.item_id)),
    "sync:morning_brief", `no longer in the Morning Brief of ${date}`);
  return {
    ok: true, page_url: b.page_url, top_priority: b.top_priority,
    meetings: b.meetings, needs_reply: b.needs_reply, items: items.length,
    opened: o.opened, resolved: rec.resolved, held_tier3: rec.held_tier3,
    errors: [...o.errors, ...rec.errors],
  };
}

async function syncJira(db, env, fetcher, date) {
  const j = await fetchJira(env, fetcher);
  if (!j.ok) return { ok: false, skipped: !!j.skipped, reason: j.reason };
  const items = jiraToItems(j.issues, { baseUrl: env.JIRA_BASE_URL, today: date });
  const o = await openItems(db, items, "sync:jira");
  const rec = await reconcile(db, "jira", new Set(items.map((i) => i.item_id)),
    "sync:jira", "issue no longer open in Jira");
  return {
    ok: true, items: items.length, opened: o.opened, resolved: rec.resolved,
    held_tier3: rec.held_tier3, errors: [...o.errors, ...rec.errors],
  };
}

export async function snapshotCounts(db) {
  const rows = (await db.prepare(
    `SELECT COALESCE(org, 'other') AS org, tier, COUNT(*) AS n FROM queue
      WHERE state IN ('open','escalated') GROUP BY 1, 2`
  ).all()).results;
  const by_org = Object.fromEntries([...ORGS, "other"].map((o) => [o, 0]));
  const by_tier = { 1: 0, 2: 0, 3: 0 };
  for (const r of rows) {
    by_org[r.org] = (by_org[r.org] ?? 0) + r.n;
    by_tier[r.tier] = (by_tier[r.tier] ?? 0) + r.n;
  }
  return { open_total: rows.reduce((s, r) => s + r.n, 0), by_org, by_tier };
}

export async function runDailySync(env, { fetcher = fetch, trigger = "manual" } = {}) {
  const db = env.DB;
  const policy = await ensureOpsPolicy(db);
  const date = chicagoDate();
  const health = await syncHealth(db, env, fetcher, date);
  const brief = await syncBrief(db, env, fetcher, date);
  const jira = await syncJira(db, env, fetcher, date);
  const counts = await snapshotCounts(db);
  const summary = { date, trigger, policy_installed: policy.installed, health, brief, jira, counts };
  const rec = await appendEvent(db, {
    domain: "ops",
    event_type: "source_sync",
    subject_type: "system",
    subject_id: "daily-sync",
    actor: "system",
    actor_identity: `sync:${trigger}`,
    payload: summary,
  });
  return { ...summary, recorded: rec.seq };
}
