# Governance

ProofStream (PST) is a subsidiary scope under Pantheon Consulting Group. The full operating
doctrine lives in PCG's `CLAUDE.md`; this file is the part that constrains what `create-app`
may scaffold without a human in the loop.

## Scope

ProofStream code lives in the `pst.*` namespace. Scope isolation is absolute: a `pst.*`
surface cannot read or write another entity's data. Cross-entity work uses `shared.*`
tooling (`whoami`, `audit.search`, `document.resolve`, `entity.list_scopes`) or delegates
with a handoff record:

```json
{
  "handoff_from": "think-tank/PCG",
  "handoff_to": "<agent>/<scope>",
  "task_summary": "...",
  "context_document_id": "PCG-...",
  "requires_return": true,
  "approval_pending": "TCW"
}
```

Every workflow returns to TCW for final approval. Scaffolded code never escalates its own
permissions and never widens its own scope to make a call succeed.

## Hard stops

Scaffold the code path, wire the approval gate, and **stop before execution**. These
require explicit TCW confirmation at runtime, every time:

- **Signing** — `pcg.contract.sign`, any `sign:*` tool, PIV-9C document signing.
- **Money** — `pst.fiduciary.pay`, `pst.token.mint`, `pst.token.transfer`, first invoice
  issuance. Anything that moves value, including an on-chain anchor that spends gas from a
  funded mainnet wallet.
- **Identity** — Auth0 role assignment, permission changes, `app_metadata` writes.
- **Schema** — any change to the KV storage format in `workers-oauth-provider`.
- **Infrastructure** — force-push, `git reset --hard`, branch deletion, CI/CD edits.
- **Zero Trust** — device enrollment, MFA policy, TLS inspection scope.

A hard stop encountered mid-sequence halts the **whole sequence**. Report the blocking
action and why, then wait. Do not complete the surrounding steps and leave the blocked one
as a footnote.

An unfunded testnet anchor is not a hard stop. A mainnet write is. If the scaffold can
reach both, the network must be explicit in configuration, never defaulted.

## Auth

Identity is Auth0 (`pantheon-platform.us.auth0.com`), RS256, claims under the
`https://pcg.io/` namespace. Scaffolded code that validates a token:

- checks `iss` **and** `aud` strictly — a token minted for one resource server is not valid
  for another, even in the same tenant;
- rejects dev and staging tokens in production;
- rejects HS256 outright. The server is RS256; symmetric signing is refused and escalated,
  not accommodated;
- requires AAL2 for every `sign:*` and document-binding-required path.

Authorization code + PKCE only. Never propose the implicit flow as a workaround.

## Errors

Each has one correct response. None of them is "retry with more privilege".

| Code | Meaning | Response |
|---|---|---|
| `-32000` | JWT invalid | stop, report, do not retry with a different token |
| `-32001` | Scope denied | stop the sequence, report the exact scope gap, do not reroute |
| `-32002` | Role insufficient | report, ask TCW to check the Auth0 role assignment |
| `-32003` | AAL too low | halt, AAL2 re-authentication required |
| `-32004` | Rate limited | honour `Retry-After`, report if persistent |
| `-32005` | Document binding missing | halt, re-authenticate bound to the Document ID |
| `-32030` | Upstream error | capture detail, retry **once**, escalate if persistent |

## Secrets

Never stored, logged, or transmitted. Access tokens, refresh tokens, client secrets,
YubiKey PINs, and PIV key material never appear in responses, files, comments, commits,
test fixtures, or handoff records. Refer to a credential by name.

Prefer a hardware signer or a vault reference over a raw private key. A `.env` is
acceptable for testnet and dev; a mainnet signing key does not belong in one, and saying so
plainly is part of the job.

## Audit

Every tool invocation produces an `audit_id`. Capture it and surface the outcome,
`document_id`, and `entity_scope`. **If an audit record cannot be confirmed, the operation
is unverified** — report it that way rather than as complete.

## Document IDs

`[ENTITY]-[CATEGORY]-[YEAR]-[SEQUENCE]-[VERSION]`. Register via `pcg.document.register`
before issuing. Never reuse an ID.

## Code

- `npm run check` (from `worker/`) passes before anything is called done, and before any
  push to `main`. Contract changes additionally pass `npm test` at the repository root.
- No `any` without written justification.
- No new runtime dependency without TCW confirmation. The domain layer has none — keep it
  that way.
- A change to token storage, PKCE, redirect URI validation, or scope handling states its
  security implications explicitly in the PR.
- Governing law: Wyoming. Gold accent `#C8A96E` on styled deliverables.
