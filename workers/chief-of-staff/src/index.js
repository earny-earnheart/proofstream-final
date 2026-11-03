import { verifyChain } from "./ledger.js";
import { runNightly } from "./nightly.js";
import { HttpError, handleIngest, ingestAuthorized, reply, tokenOk } from "./ingest.js";
import { decideItem } from "./decide.js";
import { runDailySync } from "./sync.js";
import { PAGE } from "./page.js";

export const CRON_NIGHTLY = "0 7 * * *";   // 01:00 Chicago: chain verify + queue rebuild
export const CRON_SYNC = "30 14 * * *";    // 08:30 Chicago (CST): after the 08:00 Morning Brief

function dashToken(request) {
  const url = new URL(request.url);
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const cookie = (request.headers.get("cookie") || "").split(";").map((s) => s.trim())
    .find((s) => s.startsWith("cos_token="));
  const cookieTok = cookie ? decodeURIComponent(cookie.split("=")[1]) : "";
  return url.searchParams.get("t") || bearer || cookieTok;
}

// Unchanged behaviour for reads: no DASH_TOKEN set means the page is open.
function requireAuth(request, env) {
  if (!env.DASH_TOKEN) return null;
  return tokenOk(dashToken(request), env.DASH_TOKEN) ? null : new Response("Unauthorized", { status: 401 });
}

// Writes from the page need a configured token, a JSON body (a cross-site
// form cannot send one without a CORS preflight) and a same-origin Origin.
function writeGuard(request, env) {
  if (!env.DASH_TOKEN) return reply({ error: "DASH_TOKEN must be set before the dashboard can write" }, 503);
  if (request.method !== "POST") return reply({ error: "POST only" }, 405);
  if (!(request.headers.get("content-type") || "").startsWith("application/json")) {
    return reply({ error: "content-type must be application/json" }, 415);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return reply({ error: "cross-origin write refused" }, 403);
  return null;
}

async function loadPolicy(env) {
  const { results } = await env.DB.prepare(
    `SELECT key, value_json, locked, version FROM policy WHERE superseded_at IS NULL`
  ).all();
  const map = {};
  for (const r of results) {
    try {
      map[r.key] = { ...JSON.parse(r.value_json), _locked: !!r.locked, _version: r.version };
    } catch {
      map[r.key] = { _raw: r.value_json, _locked: !!r.locked, _version: r.version };
    }
  }
  return map;
}

async function getSummary(env) {
  const db = env.DB;
  const policy = await loadPolicy(env);
  const queue = (await db.prepare(
    `SELECT item_id, domain, task, tier, tier_reason, owner_role, created_at, deadline,
            escalation_idx, state, org, source, ref_url
       FROM queue WHERE state IN ('open','escalated')
      ORDER BY tier DESC, deadline ASC LIMIT 300`
  ).all()).results;
  const now = Date.now();
  const items = queue.map((q) => {
    const dl = Date.parse(q.deadline);
    return {
      ...q,
      org: q.org || "other",
      overdue: Number.isFinite(dl) && dl < now,
      hoursLeft: Number.isFinite(dl) ? Math.round((dl - now) / 36e5) : null,
    };
  });
  const quarantined = new Set((await db.prepare(
    `SELECT subject_id FROM quarantine WHERE released_at IS NULL`
  ).all()).results.map((r) => r.subject_id));
  for (const it of items) it.quarantined = quarantined.has(it.item_id);

  const syncRows = (await db.prepare(
    `SELECT seq, ts, payload_json FROM ledger WHERE event_type = 'source_sync'
      ORDER BY seq DESC LIMIT 60`
  ).all()).results;
  const history = [];
  const seenDates = new Set();
  for (const r of syncRows) {
    const p = JSON.parse(r.payload_json);
    if (seenDates.has(p.date)) continue; // latest run per day
    seenDates.add(p.date);
    history.push({ ts: r.ts, ...p });
    if (history.length === 14) break;
  }

  const count = (f) => items.filter(f).length;
  return {
    generated_at: new Date().toISOString(),
    tz: "America/Chicago",
    counts: {
      tier3: count((q) => q.tier === 3),
      tier2: count((q) => q.tier === 2),
      tier1: count((q) => q.tier === 1),
      overdue: count((q) => q.overdue),
    },
    items,
    latest_sync: history[0] || null,
    history,
    system: {
      roles: (await db.prepare(
        `SELECT role_id, holder_identity, alternate_identity FROM roles
          WHERE superseded_at IS NULL ORDER BY role_id`
      ).all()).results,
      quarantine: (await db.prepare(
        `SELECT subject_id, reason, entered_at FROM quarantine WHERE released_at IS NULL
          ORDER BY entered_at LIMIT 50`
      ).all()).results,
      ledger: (await db.prepare(
        `SELECT seq, ts, event_type, subject_id, actor_identity FROM ledger ORDER BY seq DESC LIMIT 25`
      ).all()).results,
      ledger_total: (await db.prepare(`SELECT COUNT(*) AS n FROM ledger`).first())?.n ?? 0,
      locked: Object.entries(policy).filter(([, v]) => v._locked).map(([k, v]) => ({ key: k, version: v._version })),
      cycle: policy["core.daily_cycle"] || null,
    },
  };
}

async function jsonBody(request) {
  const raw = await request.text();
  if (raw.length > 8192) throw new HttpError(413, "body too large");
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "body must be JSON");
  }
}

const asReply = (e) => {
  if (e instanceof HttpError) return reply({ error: e.message, ...e.extra }, e.status);
  console.error(e?.stack || e);
  return reply({ error: "internal error" }, 500);
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/events") return handleIngest(request, env);
    if (url.pathname === "/api/verify" && ingestAuthorized(request, env)) return reply(await verifyChain(env.DB));

    const unauth = requireAuth(request, env);
    if (unauth) return unauth;

    // ?t=<token> once -> HttpOnly cookie, then strip the token from the URL.
    const t = url.searchParams.get("t");
    if (t && env.DASH_TOKEN && tokenOk(t, env.DASH_TOKEN) && request.method === "GET") {
      url.searchParams.delete("t");
      return new Response(null, {
        status: 302,
        headers: {
          location: url.pathname + url.search,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "set-cookie": `cos_token=${encodeURIComponent(t)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
        },
      });
    }

    try {
      if (url.pathname === "/api/summary") return reply(await getSummary(env));
      if (url.pathname === "/api/verify") return reply(await verifyChain(env.DB));
      if (url.pathname === "/api/policy") return reply(await loadPolicy(env));
      if (url.pathname === "/api/decide") {
        const blocked = writeGuard(request, env);
        if (blocked) return blocked;
        const r = await decideItem(env.DB, await jsonBody(request));
        return reply(r.body, r.status);
      }
      if (url.pathname === "/api/sync") {
        const blocked = writeGuard(request, env);
        if (blocked) return blocked;
        return reply(await runDailySync(env, { trigger: "dashboard" }));
      }
    } catch (e) {
      return asReply(e);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(PAGE, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "x-frame-options": "DENY",
        },
      });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const job = event.cron === CRON_SYNC
      ? runDailySync(env, { trigger: `scheduler:${event.cron}` })
      : runNightly(env, { cron: event.cron });
    ctx.waitUntil(job.then((r) => console.log(JSON.stringify(r))).catch((e) => console.error(e?.stack || e)));
  },
};
