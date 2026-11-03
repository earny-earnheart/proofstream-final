// Minimal D1 stand-in over node:sqlite, loaded with the production baseline
// schema + migrations + the production roles and the policy keys the code uses.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

class Stmt {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Stmt(this.db, this.sql, args);
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.args) ?? null;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.args) };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(root, "schema/baseline.sql"), "utf8"));
  for (const f of readdirSync(join(root, "migrations")).sort()) {
    db.exec(readFileSync(join(root, "migrations", f), "utf8"));
  }
  const at = "2026-10-01T13:00:00-05:00";
  const roles = [
    ["channel_lead", "channel", "Arman", "JB"],
    ["operator", "publishing", "Terrell Washington", "Woolf"],
    ["principal", null, "Terrell Washington", "Woolf"],
  ];
  for (const r of roles) {
    db.prepare(`INSERT INTO roles (role_id, domain, holder_identity, alternate_identity, conflicts_with, effective_from)
                VALUES (?, ?, ?, ?, '[]', ?)`).run(...r, at);
  }
  const policy = {
    "core.escalation_timeouts": { tier3_first_hours: 24, tier3_second_hours: 48, on_second_expiry: "fail_closed" },
    "core.reversal_window": { tier2_minutes: 240 },
    "core.sequencing_hold": { outreach_send: "parked_until_verification_gate_live" },
    "gate.channel.source_compliance": { verdicts: { clear: 1, flagged: 3 } },
    "gate.channel.pii_scope": { verdicts: { practice_only: 1, contains_individual: 3 }, hard_stop: "contains_individual" },
    "gate.shared.restricted_molecule": { verdicts: { clear: 1, restricted: 3 }, molecules: ["semaglutide", "tirzepatide", "retatrutide"], all_channels: true },
    "tier_map.channel.lead_discover": { tier: 1 },
  };
  for (const [k, v] of Object.entries(policy)) {
    db.prepare(`INSERT INTO policy (policy_id, version, key, value_json, locked, effective_from, changed_by_identity, change_rationale)
                VALUES (?, 1, ?, ?, 0, ?, 'Terrell Washington', 'Genesis')`).run(k, k, JSON.stringify(v), at);
  }
  return {
    raw: db,
    prepare: (sql) => new Stmt(db, sql),
    batch: async (stmts) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

// fetch stand-in: routes is [ [matcher(url, init) => bool, () => Response], ... ]
export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [match, respond] of routes) if (match(String(url), init)) return respond(String(url), init);
    throw new Error(`unexpected fetch ${url}`);
  };
  fn.calls = calls;
  return fn;
}

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const rt = (text) => [{ plain_text: text }];
export const block = {
  h2: (t) => ({ type: "heading_2", heading_2: { rich_text: rt(t) } }),
  p: (t) => ({ type: "paragraph", paragraph: { rich_text: rt(t) } }),
  li: (t) => ({ type: "bulleted_list_item", bulleted_list_item: { rich_text: rt(t) } }),
  hr: () => ({ type: "divider", divider: {} }),
};

export function notionRoutes({ page, blocks }) {
  return [
    [(u) => u.includes("/data_sources/") && u.endsWith("/query"), () => json({ results: page ? [page] : [] })],
    [(u) => u.includes("/blocks/"), () => json({ results: blocks, has_more: false })],
  ];
}

export function briefPage({ top = "Ship the ProofStream registration fix", meetings = 2, needs = 1 } = {}) {
  return {
    id: "page-1",
    url: "https://www.notion.so/page-1",
    properties: {
      "Top Priority": { rich_text: rt(top) },
      Meetings: { number: meetings },
      "Needs Reply": { number: needs },
    },
  };
}
