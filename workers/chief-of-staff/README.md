# Chief of Staff dashboard (`chief-of-staff-dash`)

A single Cloudflare Worker + D1 database (Pantheon Enterprise account). It
pulls the day's work from your sources every morning, shows what needs you, and
records everything in an append-only, hash-chained ledger.

The source was recovered from the live bundle on 2026-11-03 (it was not in any
repo). `src/ledger.js` is byte-compatible with production: the test suite
re-hashes two real production rows.

## What fills the dashboard

| Source | How | Org | Closes items when |
|---|---|---|---|
| ☀️ Morning Brief (Notion) | Worker reads today's page at 08:30 Chicago | `[org]` tag on the bullet, else keywords, else `pantheon` | today's brief no longer lists it |
| Site health | proofstreamapp.com, earnheart.org, edge-items-api `/health` | per target (`HEALTH_TARGETS`) | the next check passes |
| Jira (optional) | REST, `assignee = currentUser() AND statusCategory != Done` | issue label `proofstream`/`earnheart`/`pantheon`, else keywords | the issue leaves the JQL result |
| Deploys / anything else | `POST /api/events` with the ingest token | required field | the caller resolves it |

Tiers:

- **Tier 3 – Your decision** (red): Morning Brief "🗳 Decisions" bullets, Jira issues labelled `decision`. Closed only by **Approve / Reject** on the dashboard.
- **Tier 2 – Attention** (amber): top priority, needs-a-reply, 🔴 overdue, sites down or Access-protected.
- **Tier 1 – Routine** (green): everything else.

## Data rules (QC)

- Every new item must have `org` ∈ `proofstream | earnheart | pantheon`, a `source` ∈ `morning_brief | jira | health | deploy | manual`, an https `ref_url` if any, and the gate verdicts its task type requires. Anything else is rejected with a 422 that names the problem.
- Item ids are deterministic (`brief:<hash of title>`, `jira:<KEY>`, `health:<site>:<episode>`), so re-running a sync never duplicates.
- A source closes items **only** after a successful read. A failed, missing or not-configured source closes nothing.
- Tier 3 is never closed automatically, nor by an ingest token. Approve/Reject needs the dashboard token. Each decision writes an `approvals` row bound to the item's original payload hash, plus an `item_resolved` ledger event. A second click cannot flip it.
- Policy for the new task types is added by the Worker itself, together with a `policy_changed` ledger event, as the genesis record requires.
- Nightly (01:00 Chicago): verify the chain, then rebuild the queue from the ledger.

## Deploy (from your Mac, about 5 minutes)

```bash
cd workers/chief-of-staff
npx wrangler@latest login                 # Pantheon Enterprise account
npx wrangler@latest d1 migrations apply chief-of-staff --remote   # adds org/source/ref_url columns
npx wrangler@latest deploy
```

Secrets (`npx wrangler@latest secret put NAME`):

| Secret | Needed for | How to get it |
|---|---|---|
| `DASH_TOKEN` | login, Approve/Reject, Sync now | `openssl rand -hex 32` (may already be set) |
| `INGEST_TOKEN` | `POST /api/events` | `openssl rand -hex 32` (may already be set) |
| `NOTION_TOKEN` | Morning Brief | notion.so/profile/integrations → New internal integration (read content). Then open the ☀️ Morning Brief database → ••• → Connections → add it |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | Jira (optional) | id.atlassian.com/manage-profile/security/api-tokens; base URL like `https://<site>.atlassian.net` |

Then open `https://chief-of-staff-dash.<subdomain>.workers.dev/?t=<DASH_TOKEN>` once and press **Sync now**.

Keep in mind:

- `wrangler.toml` has no `routes`. If the Worker has a custom domain in the Cloudflare dashboard, check it is still attached after the first deploy.
- If `DASH_TOKEN` is not set, the page is readable by anyone with the URL (that was the original behaviour), and Approve/Reject/Sync refuse to run.
- Rollback: `npx wrangler@latest rollback`. The migration only adds nullable columns, so the old code keeps working.

## Sending deploys from CI

```bash
curl -fsS -X POST "$COS_URL/api/events" \
  -H "authorization: Bearer $COS_INGEST_TOKEN" -H "content-type: application/json" \
  -d '{"action":"open","task":"deploy_record","org":"proofstream","source":"deploy",
       "item_id":"deploy:proofstream-web:'"$GITHUB_SHA"'","title":"proofstream-web deployed '"${GITHUB_SHA:0:7}"'",
       "ref_url":"'"$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"'",
       "actor_identity":"ci:github","verdicts":[{"gate":"gate.ops.health","verdict":"pass"}]}'
```

Use `"verdict":"fail"` when the post-deploy check fails (Tier 2). Close it later with `{"action":"resolve","item_id":"…","state":"done","actor_identity":"ci:github"}`.

## Tests

```bash
npm test     # Node 22.5+, no dependencies; real code against SQLite with the production schema
```
