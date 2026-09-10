---
name: create-app
description: >
  Scaffold a new ProofStream (PST) application, service, or worker so it lands on the
  conventions this repo already enforces — CID fingerprinting, the notary proof object,
  first-in-time priority, PCG hard-stop gating, and Alchemy/Pinata endpoint wiring. Use
  when the user wants to create, scaffold, bootstrap, or stand up a new ProofStream app,
  surface, screen, API, or worker; when they say "new app", "create-app", "scaffold",
  "start a new service", "add a screen", "wire up a worker"; or when new code needs to
  read or write registrations, proofs, or the content registry. Not for one-off scripts
  or edits to existing modules.
---

# create-app (ProofStream)

ProofStream sells one promise: **first in line, first in time**. Everything scaffolded here
exists to keep that promise checkable by someone who does not trust us. A new surface that
cannot be independently verified is not a ProofStream surface.

Read `references/domain-model.md` before writing code, `references/screens.md` before
building UI, and `references/governance.md` before anything that spends money, signs, or
touches identity.

## Before scaffolding: answer these four

1. **Which entity scope?** ProofStream is the `pst.*` namespace under PCG. A worker that
   needs `pcg.*` or `eet.*` data does not reach across — it delegates and emits a handoff
   record. See `references/governance.md`.
2. **Does it read or write the registry?** Reads are free to build. Writes create legal
   claims about authorship and go through the approval path, never straight to a signer.
3. **Does it need the chain?** Anchoring is the default for anything a creator will rely on
   in a dispute; skip it only for internal scratch stamps, and label those as unanchored.
4. **Is any step a hard stop?** Signing, minting, paying, issuing an invoice, or changing
   an Auth0 role halts for explicit TCW confirmation. Flag these in the plan *before*
   writing code, not when the call fails.

## Reuse the domain layer — do not re-implement it

`worker/src/domain/` is the source of truth. New code imports from it; it does not re-derive
hashing, ordering, or validation, because two implementations of "which registration came
first" is two answers in a dispute.

| Need | Use | Never |
|---|---|---|
| Fingerprint content | `contentCid(bytes)` | ad-hoc `sha256` hex as an identifier |
| Check a fingerprint's shape | `isContentCid(value)` | a length or prefix check |
| Validate a milestone | `validateMilestone(m)` | per-form field checks |
| Order a project timeline | `buildTimeline(ms)` | `.sort()` at the call site |
| Resolve a priority dispute | `firstInTime(cid, ms)` | "whichever row the query returned" |
| Validate a receipt | `validateProofObject(p)` | trusting a client-supplied proof |
| Back the Verify screen | `verifyCid` / `verifyContent` | a direct registry query |
| Gate on plan limits | `checkRegistrationQuota(plan, used)` | a hard-coded number |

If the domain layer genuinely lacks something, extend `worker/src/domain/` and test it there —
that is the scaffolding step, not a reason to inline the logic.

## Scaffold layout

The repository is a monorepo of independent package roots. The root package is the Hardhat
contracts project; everything below belongs to `worker/`, which has its own
`package.json`, `tsconfig.json`, and `node_modules`. A new surface either lives inside
`worker/` or becomes a sibling package root — it does not add itself to the root package.

```
worker/
  src/
    domain/        pure, dependency-free rules — the layer above must not fork these
    worker/        the OpenAPI Worker: Hono + chanfana, endpoints/, storage seams
    <surface>/     a new app: routes, handlers, components
  tests/
    <surface>.test.ts
```

Keep `worker/src/domain/` free of network, filesystem, and framework imports. It stays pure so
the rules that decide authorship can be tested exhaustively and audited by a non-engineer.
Endpoint calls (Alchemy, Pinata, gateway) live in the surface layer behind an interface
the tests can substitute.

Hash through **Web Crypto**, never `node:crypto`. The same fingerprint implementation has
to run in the browser, where the creator's file is hashed and must never be uploaded. A
second, synchronous implementation for the server would be two answers to "what is this
work's identity" — the one thing a fingerprint may not have.

### Adding an endpoint to the Worker

Class-based chanfana routes in `worker/src/worker/endpoints/`, registered in `worker/src/worker/index.ts`.
Each declares its `schema` (tags, summary, request, responses) so the OpenAPI document and
the validation come from one declaration. Storage goes through the `RegistryStore`
interface — the KV implementation in the Worker, the in-memory one in tests, so endpoint
behaviour is exercised end to end without workerd.

Describe security-relevant response fields in the schema itself, not just in prose:
`anchored` carries a `.describe()` telling consumers not to present an unanchored proof as
chain-backed, and that text ships in the published API document.

## Endpoint wiring

Follow the `pcg-endpoint-connector` conventions exactly — that skill is the single
definition of how anything in this fleet authenticates. In short: Alchemy key per network
with a compute-unit cap, Pinata JWT scoped to `org:files:write` + `org:files:read` (never
an Admin key), secrets from `.env` in dev and a secret manager in production, and a
health check that fails loud at boot rather than halfway through a pipeline.

A scaffolded app must:

- read every credential from the environment, never a literal;
- refuse to start if a required endpoint fails its health check;
- keep keys, JWTs, and signatures out of logs, errors, and committed fixtures;
- ship a `.env.example` with key *names* only.

## Writes stay shut until a principal can be authenticated

A registration is a claim of authorship. An endpoint that records one without an
authenticated principal lets anyone file a claim against anyone's project, so the write
path **fails closed** rather than trusting an owner or a plan supplied in the request
body. `POST /api/registrations` is the worked example: it validates fully, then returns
501 naming what blocks it. Deny by default is the rule; an open write path is not a
"temporary" state to ship.

Never take the account's plan from the client. Resolve it from the authenticated
principal, and default to the most restrictive tier when it cannot be resolved.

## Tests are part of the scaffold, not a follow-up

`npm run check` from `worker/` (typecheck + `vitest run` + a Worker bundle) must pass
before a surface is called done. The bundle step matters: code that type-checks but exceeds the size limit or
pulls a Node built-in still fails to deploy, and CI is where that should surface. For
every new module, cover:

- **The happy path**, once.
- **Every rejection branch** — a validator that is never seen rejecting is untested.
- **The tie and the empty case.** Empty registry, empty timeline, identical timestamps.
  `firstInTime` deliberately returns *no* winner on an exact tie; new code that resolves
  priority must preserve that rather than picking arbitrarily.
- **Boundaries, not just middles.** Quota tests check 4/5/6, not 1.
- **Round-trips** for anything encoded — encode/decode, hash/verify.
- **Known-answer vectors** for anything cryptographic. `worker/tests/fingerprint.test.ts` pins
  RFC 4648 base32 vectors and published CIDs; an implementation that only agrees with
  itself proves nothing.

Use real fixtures derived from the domain helpers (`contentCid(utf8("..."))`), not
hand-typed hashes — a hand-typed CID that is subtly malformed makes a passing test lie.

## Guardrails that survive the scaffold

- **Never present an unanchored proof as chain-backed.** `isAnchored()` exists for this;
  the Verify surface must show the difference.
- **An `anchorTx` without an `anchorChainId` is unverifiable** and is rejected, not stored.
- **Hash locally.** The Verify flow promises the file never leaves the creator's machine.
  Verification takes a CID or bytes hashed client-side — do not add an upload step.
- **Do not claim "notarized."** ProofStream produces a blockchain-anchored attestation.
  A notarial act requires a commissioned notary; the wrong word invites a challenge that
  the right word does not. See `proofstream-notary`.
- **Quota copy and quota code share one source.** `worker/src/domain/plans.ts` backs both the
  pricing screen and the gate; changing one without the other is a billing defect.

## Finish

State plainly what was scaffolded, what `npm run check` reported, which endpoints are
wired versus stubbed, and which steps are hard-stops still awaiting TCW confirmation.
Partial work is reported as partial — a surface with a stubbed signer is not "done".
