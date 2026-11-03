// Daily data sources. Each fetcher returns { ok, ... } and never throws, so
// one broken source cannot block the others. Parsers are pure functions.
import { ORGS } from "./policy.js";
import { sha256hex } from "./ledger.js";

export const TZ = "America/Chicago";
export const chicagoDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD

// ---------- org classification ----------
const TAG_RE = /^\s*\[(proofstream|earnheart|pantheon)\]\s*/i;
export function classifyOrg(text) {
  const tag = TAG_RE.exec(text);
  if (tag) return tag[1].toLowerCase();
  const t = text.toLowerCase();
  if (t.includes("proofstream")) return "proofstream";
  if (t.includes("earnheart") || /\bearn\b/.test(t)) return "earnheart";
  return "pantheon"; // enterprise default
}

// Strip tag, markdown and volatile tails ("· 3h", "🔴") so the same task
// hashes to the same id on consecutive days.
export function cleanTitle(text) {
  return text
    .replace(TAG_RE, "")
    .replace(/\*\*/g, "")
    .replace(/🔴/g, "")
    .replace(/\s*·\s*\d+\s*(m|min|mins|h|hr|hrs|hours?|d|days?|w|weeks?)( ago)?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
const hashId = async (prefix, text) =>
  `${prefix}:${(await sha256hex(text.toLowerCase())).slice(0, 16)}`;

// ---------- health checks ----------
export const DEFAULT_TARGETS = [
  { name: "proofstreamapp", org: "proofstream", url: "https://proofstreamapp.com" },
  { name: "earnheart", org: "earnheart", url: "https://earnheart.org" },
  { name: "edge-items-api", org: "pantheon", url: "https://edge-items-api.pantheon-platform.workers.dev/health" },
];

export function parseTargets(raw) {
  if (!raw) return DEFAULT_TARGETS;
  const list = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(list)) throw new Error("HEALTH_TARGETS must be a JSON array");
  for (const t of list) {
    if (!/^[a-z0-9-]{1,40}$/.test(t?.name || "")) throw new Error(`bad target name ${t?.name}`);
    if (!ORGS.includes(t.org)) throw new Error(`bad org for ${t.name}`);
    if (!/^https:\/\//.test(t.url || "")) throw new Error(`target ${t.name} needs an https url`);
  }
  return list;
}

// Follows up to 3 redirects by hand so a Cloudflare Access login redirect is
// recognised as "protected" (warn) rather than a healthy 200 login page.
export async function checkTarget(fetcher, target, timeoutMs = 10000) {
  const started = Date.now();
  let url = target.url;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetcher(url, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": "chief-of-staff-dash/healthcheck" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const ms = Date.now() - started;
      if (res.status >= 200 && res.status < 300) return { ...target, verdict: "pass", status: res.status, ms };
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location") || "";
        if (/cloudflareaccess\.com/i.test(loc)) {
          return { ...target, verdict: "warn", status: res.status, ms, note: "behind Cloudflare Access" };
        }
        if (!loc) return { ...target, verdict: "fail", status: res.status, ms, note: "redirect without location" };
        url = new URL(loc, url).toString();
        continue;
      }
      return { ...target, verdict: "fail", status: res.status, ms };
    }
    return { ...target, verdict: "fail", status: null, ms: Date.now() - started, note: "too many redirects" };
  } catch (e) {
    return { ...target, verdict: "fail", status: null, ms: Date.now() - started, note: String(e?.name || e).slice(0, 80) };
  }
}

// ---------- Morning Brief (Notion) ----------
const NOTION = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const plain = (rt) => (rt || []).map((r) => r.plain_text ?? "").join("");

export function sectionOf(heading) {
  const h = heading.toLowerCase();
  if (h.includes("one thing")) return "top";
  if (h.includes("needs a reply")) return "reply";
  if (h.includes("due or overdue")) return "due";
  if (h.includes("decision")) return "decision";
  return null;
}

export function parseBriefBlocks(blocks) {
  const sections = { top: [], reply: [], due: [], decision: [] };
  let cur = null;
  for (const b of blocks) {
    if (b.type === "heading_1" || b.type === "heading_2" || b.type === "heading_3") {
      cur = sectionOf(plain(b[b.type].rich_text));
      continue;
    }
    if (b.type === "divider") {
      cur = null;
      continue;
    }
    if (!cur) continue;
    if (b.type === "to_do" && b.to_do.checked) continue;
    if (["bulleted_list_item", "numbered_list_item", "to_do"].includes(b.type)) {
      const text = plain(b[b.type].rich_text).trim();
      if (text) sections[cur].push(text);
    }
  }
  return sections;
}

const JIRA_KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/;
const EMPTY_TOP_RE = /^(no |nothing)/i;

// -> items ready for openItem (minus actor_identity).
export async function briefToItems({ pageUrl, topPriority, sections, skipJiraKeys }) {
  const out = new Map();
  const add = async (section, raw, verdict) => {
    if (skipJiraKeys && JIRA_KEY_RE.test(raw)) return; // the Jira source owns it
    const title = cleanTitle(raw);
    if (!title) return;
    const item_id = await hashId("brief", title);
    if (out.has(item_id)) return;
    out.set(item_id, {
      item_id,
      task: "brief_item",
      title,
      org: classifyOrg(raw),
      source: "morning_brief",
      ref_url: pageUrl || null,
      verdicts: [{ gate: "gate.ops.needs_decision", verdict }],
      payload: { section },
    });
  };
  if (topPriority && !EMPTY_TOP_RE.test(topPriority.trim())) await add("top", topPriority, "attention");
  for (const t of sections.decision) await add("decision", t, "yes");
  for (const t of sections.reply) await add("reply", t, "attention");
  for (const t of sections.due) await add("due", t, t.includes("🔴") ? "attention" : "no");
  return [...out.values()];
}

export async function fetchBrief(env, fetcher, date) {
  if (!env.NOTION_TOKEN) return { ok: false, skipped: true, reason: "NOTION_TOKEN not set" };
  const ds = env.BRIEF_DATA_SOURCE_ID;
  if (!ds) return { ok: false, skipped: true, reason: "BRIEF_DATA_SOURCE_ID not set" };
  const headers = {
    authorization: `Bearer ${env.NOTION_TOKEN}`,
    "notion-version": NOTION_VERSION,
    "content-type": "application/json",
  };
  try {
    const q = await fetcher(`${NOTION}/data_sources/${ds}/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        filter: { property: "Date", date: { equals: date } },
        sorts: [{ timestamp: "created_time", direction: "descending" }],
        page_size: 1,
      }),
    });
    if (!q.ok) return { ok: false, reason: `notion query HTTP ${q.status}` };
    const page = (await q.json()).results?.[0];
    if (!page) return { ok: false, reason: `no Morning Brief page dated ${date} yet` };
    const props = page.properties || {};
    const blocks = [];
    let cursor;
    for (let i = 0; i < 5; i++) {
      const u = new URL(`${NOTION}/blocks/${page.id}/children`);
      u.searchParams.set("page_size", "100");
      if (cursor) u.searchParams.set("start_cursor", cursor);
      const r = await fetcher(u.toString(), { headers });
      if (!r.ok) return { ok: false, reason: `notion blocks HTTP ${r.status}` };
      const j = await r.json();
      blocks.push(...(j.results || []));
      if (!j.has_more) break;
      cursor = j.next_cursor;
    }
    return {
      ok: true,
      page_url: page.url,
      top_priority: plain(props["Top Priority"]?.rich_text),
      meetings: props.Meetings?.number ?? null,
      needs_reply: props["Needs Reply"]?.number ?? null,
      sections: parseBriefBlocks(blocks),
    };
  } catch (e) {
    return { ok: false, reason: `notion error: ${String(e?.message || e).slice(0, 120)}` };
  }
}

// ---------- Jira ----------
export const DEFAULT_JQL = "assignee = currentUser() AND statusCategory != Done ORDER BY duedate ASC";

export function jiraEnabled(env) {
  return Boolean(env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN);
}

// Org: an org label on the issue (proofstream/earnheart/pantheon) wins;
// otherwise keywords in summary/project; otherwise pantheon.
export function jiraToItems(issues, { baseUrl, today }) {
  return issues.map((i) => {
    const f = i.fields || {};
    const labels = (f.labels || []).map((l) => l.toLowerCase());
    const overdue = Boolean(f.duedate && f.duedate < today);
    const verdict = labels.includes("decision") || labels.includes("needs-decision")
      ? "yes" : overdue ? "attention" : "no";
    const orgLabel = labels.find((l) => ORGS.includes(l));
    return {
      item_id: `jira:${i.key}`,
      task: "jira_task",
      title: `${i.key} ${f.summary || ""}`.trim().slice(0, 500),
      org: orgLabel || classifyOrg(`${f.summary || ""} ${f.project?.name || ""}`),
      source: "jira",
      ref_url: `${baseUrl.replace(/\/$/, "")}/browse/${i.key}`,
      verdicts: [{ gate: "gate.ops.needs_decision", verdict }],
      payload: { status: f.status?.name ?? null, duedate: f.duedate ?? null, overdue },
    };
  });
}

export async function fetchJira(env, fetcher) {
  if (!jiraEnabled(env)) return { ok: false, skipped: true, reason: "JIRA_* secrets not set" };
  const u = new URL(`${env.JIRA_BASE_URL.replace(/\/$/, "")}/rest/api/3/search/jql`);
  u.searchParams.set("jql", env.JIRA_JQL || DEFAULT_JQL);
  u.searchParams.set("fields", "summary,duedate,labels,status,project");
  u.searchParams.set("maxResults", "50");
  try {
    const r = await fetcher(u.toString(), {
      headers: {
        authorization: `Basic ${btoa(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`)}`,
        accept: "application/json",
      },
    });
    if (!r.ok) return { ok: false, reason: `jira HTTP ${r.status}` };
    const j = await r.json();
    return { ok: true, issues: j.issues || [] };
  } catch (e) {
    return { ok: false, reason: `jira error: ${String(e?.message || e).slice(0, 120)}` };
  }
}
