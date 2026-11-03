import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb, fakeFetch, json, block, notionRoutes, briefPage } from "./helpers.js";
import { rowHash, sha256hex, verifyChain, appendEvent } from "../src/ledger.js";
import { openItem, resolveItem } from "../src/ingest.js";
import { rebuildQueue } from "../src/nightly.js";
import { runDailySync } from "../src/sync.js";
import { decideItem } from "../src/decide.js";
import { briefToItems, checkTarget, classifyOrg, cleanTitle, jiraToItems, parseBriefBlocks } from "../src/sources.js";
import worker from "../src/index.js";
import { PAGE } from "../src/page.js";

// Two real rows from production (seq 2 and 36). If the recovered hashing code
// drifted from the deployed code by one byte, these would not reproduce.
const PROD_ROWS = [
  { seq: 2, ts: "2026-10-02T07:00:14.413Z", domain: "core", event_type: "nightly_check", subject_type: "system", subject_id: "chief-of-staff", actor: "system", actor_identity: "scheduler:0 7 * * *", payload_json: "{\"ok\":true,\"chain\":{\"ok\":true,\"rows\":1,\"head\":\"e8277f43b4730fc08bef5c72ed5a660170b6b5f513d09f691a683d17faa5318e\"},\"queue\":{\"events\":0,\"projected\":0,\"repaired\":[],\"orphans\":[]}}", payload_sha256: "9f634626dd1dcba8ac2e5413160c0ce2b8c0435687d22e16e0a83db6ecf43571", prev_hash: "e8277f43b4730fc08bef5c72ed5a660170b6b5f513d09f691a683d17faa5318e", row_hash: "ad5797711faf47a074c1c3521fd4d4a54539a886bb600c9d73af8814cc1e3bad" },
  { seq: 36, ts: "2026-11-03T07:00:43.827Z", domain: "core", event_type: "nightly_check", subject_type: "system", subject_id: "chief-of-staff", actor: "system", actor_identity: "scheduler:0 7 * * *", payload_json: "{\"ok\":true,\"chain\":{\"ok\":true,\"rows\":35,\"head\":\"f14398bfe3e77dedc32f0868f67e39b351e7f340219b0052ad67668d6f7b584d\"},\"queue\":{\"events\":2,\"projected\":1,\"repaired\":[],\"orphans\":[]}}", payload_sha256: "6859f22d1af866f944e12b21429bb5eaca7c5df8da322d36929d7f971820a749", prev_hash: "f14398bfe3e77dedc32f0868f67e39b351e7f340219b0052ad67668d6f7b584d", row_hash: "9022e87cee1e166fb456376c0d13f214ed4cf786a03fcd553519e4cb8531adce" },
];

test("ledger hashing reproduces real production rows", async () => {
  for (const r of PROD_ROWS) {
    assert.equal(await sha256hex(r.payload_json), r.payload_sha256);
    assert.equal(await rowHash(r), r.row_hash);
  }
});

const AGENT = { actor_identity: "test" };
const ops = (o) => ({ task: "brief_item", title: "Do the thing", org: "pantheon", source: "manual",
  verdicts: [{ gate: "gate.ops.needs_decision", verdict: "no" }], ...AGENT, ...o });

async function withPolicy() {
  const db = makeDb();
  const { ensureOpsPolicy } = await import("../src/policy.js");
  await ensureOpsPolicy(db);
  return db;
}

test("policy install is logged once and is idempotent", async () => {
  const db = makeDb();
  const { ensureOpsPolicy } = await import("../src/policy.js");
  const a = await ensureOpsPolicy(db);
  const b = await ensureOpsPolicy(db);
  assert.equal(a.installed.length, 7);
  assert.deepEqual(b.installed, []);
  const ev = db.raw.prepare(`SELECT COUNT(*) n FROM ledger WHERE event_type='policy_changed'`).get();
  assert.equal(ev.n, 1);
  assert.equal((await verifyChain(db)).ok, true);
});

test("ingest QC: org, source, ref_url and gates are validated", async () => {
  const db = await withPolicy();
  const rej = async (body, re) => assert.rejects(openItem(db, body), (e) => e.status === 422 && re.test(e.message));
  await rej(ops({ org: undefined }), /org required/);
  await rej(ops({ org: "acme" }), /org must be one of/);
  await rej(ops({ source: "twitter" }), /source must be one of/);
  await rej(ops({ ref_url: "http://insecure.example" }), /https/);
  await rej(ops({ ref_url: "not a url" }), /absolute URL/);
  await rej(ops({ verdicts: [] }), /required gates missing/);
  await rej(ops({ verdicts: [{ gate: "gate.ops.needs_decision", verdict: "maybe" }] }), /not allowed/);
  await rej(ops({ item_id: "bad id with spaces" }), /item_id/);
  const ok = await openItem(db, ops({ item_id: "x:1", ref_url: "https://example.com/a" }));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.org, "pantheon");
  const row = db.raw.prepare(`SELECT org, source, ref_url FROM queue WHERE item_id='x:1'`).get();
  assert.deepEqual({ ...row }, { org: "pantheon", source: "manual", ref_url: "https://example.com/a" });
  const again = await openItem(db, ops({ item_id: "x:1" }));
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
});

test("legacy lead_discover still works and its payload keeps the old shape", async () => {
  const db = await withPolicy();
  const r = await openItem(db, {
    task: "lead_discover", title: "Smoke", ...AGENT, item_id: "smoke:1",
    verdicts: [
      { gate: "gate.channel.source_compliance", verdict: "clear" },
      { gate: "gate.channel.pii_scope", verdict: "practice_only" },
      { gate: "gate.shared.restricted_molecule", verdict: "clear" },
    ],
  });
  assert.equal(r.status, 201);
  const p = JSON.parse(db.raw.prepare(`SELECT payload_json FROM ledger WHERE subject_id='smoke:1'`).get().payload_json);
  assert.equal("org" in p || "source" in p || "ref_url" in p, false);
});

test("restricted molecule forces Tier 3 on ops items too (all_channels)", async () => {
  const db = await withPolicy();
  const r = await openItem(db, ops({ item_id: "m:1", title: "Order semaglutide samples" }));
  assert.equal(r.body.tier, 3);
});

test("tier 2 ops items get no reversal window (nothing to reverse)", async () => {
  const db = await withPolicy();
  await openItem(db, ops({ item_id: "t2:1", verdicts: [{ gate: "gate.ops.needs_decision", verdict: "attention" }] }));
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM reversals`).get().n, 0);
});

test("parsers: brief blocks, org classification, stable titles", async () => {
  const blocks = [
    block.h2("🎯 Today's one thing"), block.p("Ship it."),
    block.h2("📬 Needs a reply"), block.li("**Ana** — wants the deck · Gmail · 3h"), block.p("ignored"),
    block.h2("⏰ Due or overdue"), block.li("[earnheart] Renew earnheart.org domain — Nov 3 🔴"), block.li("SCRUM-1 Dashboard — Jul 31 🔴"),
    block.h2("🗳 Decisions"), block.li("[proofstream] Approve mainnet deploy budget"),
    block.hr(), block.li("after divider: ignored"),
  ];
  const s = parseBriefBlocks(blocks);
  assert.deepEqual(s.reply, ["**Ana** — wants the deck · Gmail · 3h"]);
  assert.equal(s.due.length, 2);
  assert.equal(s.decision.length, 1);
  assert.equal(cleanTitle("**Ana** — wants the deck · Gmail · 3h"), "Ana — wants the deck · Gmail");
  assert.equal(cleanTitle("**Ana** — wants the deck · Gmail · 2 days"), "Ana — wants the deck · Gmail");
  assert.equal(classifyOrg("[earnheart] x"), "earnheart");
  assert.equal(classifyOrg("ProofStream mint"), "proofstream");
  assert.equal(classifyOrg("Quarterly taxes"), "pantheon");

  const items = await briefToItems({ pageUrl: "https://www.notion.so/p", topPriority: "No urgent items", sections: s, skipJiraKeys: true });
  assert.equal(items.length, 3, "top skipped (empty-state), Jira-key bullet skipped");
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.equal(byTitle["Approve mainnet deploy budget"].verdicts[0].verdict, "yes");
  assert.equal(byTitle["Approve mainnet deploy budget"].org, "proofstream");
  assert.equal(byTitle["Renew earnheart.org domain — Nov 3"].verdicts[0].verdict, "attention");
  for (const i of items) assert.match(i.item_id, /^brief:[0-9a-f]{16}$/);
});

test("health check: pass, Access redirect = warn, error = fail, redirects followed", async () => {
  const f = fakeFetch([
    [(u) => u === "https://a.test/", () => new Response("ok", { status: 200 })],
    [(u) => u === "https://b.test/", () => new Response(null, { status: 302, headers: { location: "https://x.cloudflareaccess.com/login" } })],
    [(u) => u === "https://c.test/", () => new Response("no", { status: 503 })],
    [(u) => u === "https://d.test/", () => new Response(null, { status: 301, headers: { location: "https://www.d.test/" } })],
    [(u) => u === "https://www.d.test/", () => new Response("ok", { status: 200 })],
  ]);
  const t = (n) => ({ name: n, org: "pantheon", url: `https://${n}.test/` });
  assert.equal((await checkTarget(f, t("a"))).verdict, "pass");
  assert.equal((await checkTarget(f, t("b"))).verdict, "warn");
  assert.equal((await checkTarget(f, t("c"))).verdict, "fail");
  assert.equal((await checkTarget(f, t("d"))).verdict, "pass");
  assert.equal((await checkTarget(f, t("zzz"))).verdict, "fail", "network error is a fail, not a throw");
});

test("jira mapping: labels drive decision and org", () => {
  const items = jiraToItems([
    { key: "SCRUM-1", fields: { summary: "Pantheon-Platform Dashboard", duedate: "2026-07-31", labels: [], project: { name: "SCRUM" } } },
    { key: "SCRUM-2", fields: { summary: "Mint pricing", duedate: null, labels: ["decision", "proofstream"] } },
  ], { baseUrl: "https://x.atlassian.net/", today: "2026-11-03" });
  assert.equal(items[0].verdicts[0].verdict, "attention");
  assert.equal(items[0].ref_url, "https://x.atlassian.net/browse/SCRUM-1");
  assert.equal(items[1].verdicts[0].verdict, "yes");
  assert.equal(items[1].org, "proofstream");
});

// ---------- end-to-end daily sync ----------
const TARGETS = JSON.stringify([
  { name: "ps", org: "proofstream", url: "https://ps.test/" },
  { name: "eh", org: "earnheart", url: "https://eh.test/" },
]);

function env(db, extra = {}) {
  return { DB: db, HEALTH_TARGETS: TARGETS, NOTION_TOKEN: "n", BRIEF_DATA_SOURCE_ID: "ds", ...extra };
}

function syncFetch({ ehStatus = 200, blocks, page = briefPage() }) {
  return fakeFetch([
    [(u) => u === "https://ps.test/", () => new Response("ok")],
    [(u) => u === "https://eh.test/", () => new Response("x", { status: ehStatus })],
    ...notionRoutes({ page, blocks }),
  ]);
}

const DAY1 = [
  block.h2("📬 Needs a reply"), block.li("**Ana** — wants the deck · Gmail · 3h"),
  block.h2("⏰ Due or overdue"), block.li("[earnheart] Renew domain — Nov 3 🔴"),
  block.h2("🗳 Decisions"), block.li("[proofstream] Approve mainnet budget"),
];

test("daily sync: opens items, is idempotent, reconciles, keeps Tier 3", async () => {
  const db = makeDb();
  const r1 = await runDailySync(env(db), { fetcher: syncFetch({ ehStatus: 503, blocks: DAY1 }), trigger: "test" });
  assert.equal(r1.policy_installed.length, 7);
  assert.equal(r1.brief.items, 4); // top priority + 3 bullets
  assert.equal(r1.brief.opened, 4);
  assert.equal(r1.health.opened, 1);
  assert.deepEqual(r1.brief.errors, []);
  const t3 = db.raw.prepare(`SELECT item_id, org, source FROM queue WHERE tier=3 AND state='open'`).all();
  assert.equal(t3.length, 1);
  assert.equal(t3[0].org, "proofstream");
  assert.equal(r1.counts.by_org.earnheart, 2, "domain item + site outage");

  // Same day re-run: nothing new.
  const r2 = await runDailySync(env(db), { fetcher: syncFetch({ ehStatus: 503, blocks: DAY1 }), trigger: "test" });
  assert.equal(r2.brief.opened, 0);
  assert.equal(r2.health.opened, 0);

  // Next day: site recovered, brief only lists the reply item (waiting time changed).
  const DAY2 = [block.h2("📬 Needs a reply"), block.li("**Ana** — wants the deck · Gmail · 1d")];
  const r3 = await runDailySync(env(db), { fetcher: syncFetch({ blocks: DAY2 }), trigger: "test" });
  assert.equal(r3.brief.opened, 0, "same reply item, stable id despite new waiting time");
  assert.equal(r3.brief.resolved, 1, "the dropped due item closes");
  assert.equal(r3.brief.held_tier3, 1, "the dropped decision stays open for Approve/Reject");
  assert.equal(r3.health.resolved, 1, "site recovered -> outage item closes");
  const open = db.raw.prepare(`SELECT COUNT(*) n FROM queue WHERE state='open'`).get().n;
  assert.equal(open, 3, "top priority + reply + decision");

  // Integrity: chain verifies and a full rebuild from the ledger changes nothing.
  assert.equal((await verifyChain(db)).ok, true);
  const rb = await rebuildQueue(db);
  assert.deepEqual(rb.repaired, []);
  assert.deepEqual(rb.orphans, []);
});

test("a failed or missing source never closes anything", async () => {
  const db = makeDb();
  await runDailySync(env(db), { fetcher: syncFetch({ blocks: DAY1 }), trigger: "test" });
  const before = db.raw.prepare(`SELECT COUNT(*) n FROM queue WHERE state='open'`).get().n;
  // Weekend / brief not written yet: no page for today.
  const r = await runDailySync(env(db), { fetcher: syncFetch({ blocks: [], page: null }), trigger: "test" });
  assert.equal(r.brief.ok, false);
  assert.match(r.brief.reason, /no Morning Brief page/);
  // Notion down.
  const down = fakeFetch([
    [(u) => u.endsWith(".test/"), () => new Response("ok")],
    [(u) => u.includes("notion"), () => json({ message: "nope" }, 502)],
  ]);
  const r2 = await runDailySync(env(db), { fetcher: down, trigger: "test" });
  assert.match(r2.brief.reason, /HTTP 502/);
  // Not configured at all.
  const r3 = await runDailySync(env(db, { NOTION_TOKEN: undefined }), { fetcher: down, trigger: "test" });
  assert.equal(r3.brief.skipped, true);
  assert.equal(r3.jira.skipped, true);
  const after = db.raw.prepare(`SELECT COUNT(*) n FROM queue WHERE state='open'`).get().n;
  assert.equal(after, before);
});

test("approve / reject: Tier 3 only, bound to the opened payload, once", async () => {
  const db = await withPolicy();
  await openItem(db, ops({ item_id: "d:1", verdicts: [{ gate: "gate.ops.needs_decision", verdict: "yes" }] }));
  await openItem(db, ops({ item_id: "d:2", verdicts: [{ gate: "gate.ops.needs_decision", verdict: "yes" }] }));
  await openItem(db, ops({ item_id: "r:1" }));

  await assert.rejects(decideItem(db, { item_id: "r:1", decision: "approve" }), (e) => e.status === 409);
  await assert.rejects(decideItem(db, { item_id: "d:1", decision: "maybe" }), (e) => e.status === 422);
  await assert.rejects(resolveItem(db, { item_id: "d:1", state: "done", actor_identity: "bot" }), (e) => e.status === 403,
    "agents cannot close Tier 3 through ingest");

  const a = await decideItem(db, { item_id: "d:1", decision: "approve", note: "go" });
  assert.equal(a.body.state, "done");
  assert.equal(a.body.approver, "Terrell Washington");
  const appr = db.raw.prepare(`SELECT * FROM approvals WHERE item_id='d:1'`).get();
  const opened = db.raw.prepare(`SELECT payload_sha256 FROM ledger WHERE subject_id='d:1' AND event_type='item_opened'`).get();
  assert.equal(appr.payload_sha256, opened.payload_sha256);

  const again = await decideItem(db, { item_id: "d:1", decision: "reject" });
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.state, "done", "a second click cannot flip the decision");

  const r = await decideItem(db, { item_id: "d:2", decision: "reject", note: "not now" });
  assert.equal(r.body.state, "rejected");
  assert.equal((await verifyChain(db)).ok, true);
  assert.deepEqual((await rebuildQueue(db)).repaired, []);
});

test("quarantined Tier 3 item can be rejected but not approved", async () => {
  const db = await withPolicy();
  await openItem(db, ops({ item_id: "q:1" }));
  db.raw.prepare(`INSERT INTO quarantine (q_id, domain, subject_type, subject_id, reason, entered_at)
                  VALUES ('q:q:1','ops','queue_item','q:1','hard stop','2026-11-03')`).run();
  db.raw.prepare(`UPDATE queue SET tier=3 WHERE item_id='q:1'`).run();
  await assert.rejects(decideItem(db, { item_id: "q:1", decision: "approve" }), (e) => e.status === 403);
  assert.equal((await decideItem(db, { item_id: "q:1", decision: "reject" })).body.state, "rejected");
});

// ---------- HTTP layer ----------
const req = (path, init = {}) => new Request(`https://cos.test${path}`, init);
const jsonPost = (path, body, headers = {}) => req(path, {
  method: "POST", body: JSON.stringify(body),
  headers: { "content-type": "application/json", cookie: "cos_token=secret", ...headers },
});

test("HTTP: auth, write guards, decide and summary", async () => {
  const db = await withPolicy();
  await openItem(db, ops({ item_id: "h:1", verdicts: [{ gate: "gate.ops.needs_decision", verdict: "yes" }] }));
  const e = { DB: db, DASH_TOKEN: "secret", INGEST_TOKEN: "ingest", HEALTH_TARGETS: "[]" };

  assert.equal((await worker.fetch(req("/api/summary"), e)).status, 401);
  assert.equal((await worker.fetch(req("/api/summary", { headers: { cookie: "cos_token=wrong" } }), e)).status, 401);

  const formPost = req("/api/decide", { method: "POST", body: "item_id=h:1", headers: { cookie: "cos_token=secret", "content-type": "application/x-www-form-urlencoded" } });
  assert.equal((await worker.fetch(formPost, e)).status, 415);
  assert.equal((await worker.fetch(jsonPost("/api/decide", { item_id: "h:1", decision: "approve" }, { origin: "https://evil.test" }), e)).status, 403);
  // Ingest token cannot decide.
  const viaIngest = req("/api/decide", { method: "POST", body: "{}", headers: { authorization: "Bearer ingest", "content-type": "application/json" } });
  assert.equal((await worker.fetch(viaIngest, e)).status, 401);
  // No DASH_TOKEN configured: page readable (legacy), writes refused.
  assert.equal((await worker.fetch(jsonPost("/api/decide", { item_id: "h:1", decision: "approve" }), { ...e, DASH_TOKEN: undefined })).status, 503);

  const ok = await worker.fetch(jsonPost("/api/decide", { item_id: "h:1", decision: "approve" }, { origin: "https://cos.test" }), e);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).state, "done");

  const s = await (await worker.fetch(req("/api/summary", { headers: { cookie: "cos_token=secret" } }), e)).json();
  assert.equal(s.counts.tier3, 0);
  assert.ok(Array.isArray(s.history));

  const login = await worker.fetch(req("/?t=secret"), e);
  assert.equal(login.status, 302);
  assert.match(login.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(login.headers.get("location"), "/");
});

test("HTTP: ingest endpoint accepts the new task types with the ingest token", async () => {
  const db = await withPolicy();
  const e = { DB: db, INGEST_TOKEN: "ingest" };
  const body = { action: "open", task: "deploy_record", title: "proofstream-web deployed abc123", org: "proofstream",
    source: "deploy", ref_url: "https://github.com/earny-earnheart/proofstream-web/actions/runs/1",
    item_id: "deploy:proofstream:abc123", actor_identity: "ci:github",
    verdicts: [{ gate: "gate.ops.health", verdict: "pass" }] };
  const r = await worker.fetch(req("/api/events", { method: "POST", headers: { authorization: "Bearer ingest" }, body: JSON.stringify(body) }), e);
  assert.equal(r.status, 201);
  const bad = await worker.fetch(req("/api/events", { method: "POST", headers: { authorization: "Bearer ingest" }, body: JSON.stringify({ ...body, org: "acme", item_id: "deploy:x" }) }), e);
  assert.equal(bad.status, 422);
});

test("scheduled: sync cron runs the sync, nightly cron runs the nightly check", async () => {
  const db = makeDb();
  await appendEvent(db, { domain: "core", event_type: "genesis", subject_type: "system", subject_id: "chief-of-staff", actor: "operator", payload: {} });
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const e = { DB: db, HEALTH_TARGETS: "[]" };
  await worker.scheduled({ cron: "30 14 * * *" }, e, ctx);
  await worker.scheduled({ cron: "0 7 * * *" }, e, ctx);
  await Promise.all(waits);
  const types = db.raw.prepare(`SELECT event_type FROM ledger ORDER BY seq`).all().map((r) => r.event_type);
  assert.deepEqual(types, ["genesis", "policy_changed", "source_sync", "nightly_check"]);
});

test("page script is valid JavaScript", () => {
  const m = PAGE.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m);
  assert.doesNotThrow(() => new Function(m[1]));
});
