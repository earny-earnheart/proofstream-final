**INTERNAL ONLY — not a public API and not an OpenAPI spec; scope to be decided by the core team.**

Outline of the three data reads on the `chief-of-staff-dash` Worker (`workers/chief-of-staff/src/index.js`). This is not a contract. Paths, auth, and payloads below are what the Worker does today.

These handlers do not check the HTTP method. The dashboard calls them with `GET`. Any method that passes auth returns the same JSON, except a `GET` that carries a valid `?t=` token: that request is a login redirect (see Auth) and does not return the body.

Successful responses are `200` with `content-type: application/json; charset=utf-8` and `cache-control: no-store`. The body is JSON, pretty-printed.

## Auth

Dashboard reads use `DASH_TOKEN`.

- If `DASH_TOKEN` is unset (or empty), the read returns `503` `{"error":"dashboard_not_configured"}`. No data is included.
- If `DASH_TOKEN` is set, the caller must present the same value as one of, in this order: query parameter `t`, `Authorization: Bearer <token>`, or cookie `cos_token`. A mismatch returns `401` with the plain-text body `Unauthorized`.
- `GET` with a matching `?t=` does not return the resource. The Worker responds `302` to the same path with `t` removed and sets `cos_token` (`HttpOnly`, `Secure`, `SameSite=Lax`, 30 days).

`/api/verify` has one extra path, checked before the dashboard token: a bearer that matches `INGEST_TOKEN` receives the chain result even when `DASH_TOKEN` is unset. A bearer that does not match `INGEST_TOKEN` falls through to the dashboard check above. `POST /api/events` is not one of these reads; it uses `INGEST_TOKEN` only.

## `GET /api/summary`

Auth: `DASH_TOKEN` (no ingest-token bypass).

Returns the live dashboard snapshot:

- `generated_at` — ISO timestamp of this response.
- `tz` — `"America/Chicago"`.
- `counts` — `{ tier3, tier2, tier1, overdue }` over the `items` array.
- `items` — up to 300 queue rows in state `open` or `escalated`, ordered by tier descending, then deadline ascending. Each row has `item_id`, `domain`, `task`, `tier`, `tier_reason`, `owner_role`, `created_at`, `deadline`, `escalation_idx`, `state`, `org` (`"other"` when the column is empty), `source`, `ref_url`, plus:
  - `overdue` — deadline parses and is in the past.
  - `hoursLeft` — whole hours until the deadline, or `null` when the deadline does not parse.
  - `quarantined` — an unreleased quarantine row exists for this `item_id`.
- `latest_sync` — newest `source_sync` ledger payload, or `null` when none exist. Shape: ledger `ts` plus `{ date, trigger, policy_installed, health, brief, jira, counts }`. `counts` is `{ open_total, by_org, by_tier }`.
- `history` — up to 14 of those snapshots, newest day first, one (the latest run) per `date`.
- `system`:
  - `roles` — current role rows: `role_id`, `holder_identity`, `alternate_identity`.
  - `quarantine` — up to 50 unreleased rows: `subject_id`, `reason`, `entered_at`.
  - `ledger` — last 25 ledger rows: `seq`, `ts`, `event_type`, `subject_id`, `actor_identity`.
  - `ledger_total` — number of ledger rows.
  - `locked` — current policy keys with `locked` set: `{ key, version }`.
  - `cycle` — current `core.daily_cycle` policy value, or `null`.

## `GET /api/policy`

Auth: `DASH_TOKEN` (no ingest-token bypass).

Returns the current policy map (rows with `superseded_at` null), keyed by policy key. Each value is the parsed `value_json` plus `_locked` (boolean) and `_version`. If `value_json` is not JSON, the value is `{ _raw, _locked, _version }` instead.

## `GET /api/verify`

Auth: `DASH_TOKEN`, or a bearer matching `INGEST_TOKEN`.

Walks the ledger in `seq` order and returns:

- empty ledger: `{ ok: true, rows: 0, note: "empty ledger" }`
- intact chain: `{ ok: true, rows, head }` where `head` is the last row hash
- first broken row: `{ ok: false, rows, broken_at_seq, reason }` where `reason` is `prev_hash does not link to previous row`, `payload_sha256 mismatch`, or `row_hash mismatch`
