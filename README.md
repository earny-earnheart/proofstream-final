# ProofStream

Blockchain-anchored proof of creation. Register a work, track its creative timeline, and
establish who was **first in line, first in time**.

ProofStream is the PST subsidiary scope under Pantheon Consulting Group. Governing law:
Wyoming.

## What is here

The **domain layer** — the pure rules that decide authorship — the **OpenAPI Worker**
that serves them, and the `create-app` skill that keeps new surfaces on those rules.

```
src/domain/          fingerprinting, milestones, proofs, plans (no network, no framework)
src/worker/          Cloudflare Worker: Hono + chanfana, KV-backed registry
tests/               119 tests across the domain layer and the Worker
wrangler.jsonc       Worker config — deploys as chanfana-openapi-proofstream
.claude/skills/
  create-app/        scaffolding skill for new ProofStream surfaces
```

The domain layer is deliberately dependency-free and pure. These are the rules a dispute
turns on, so they are exhaustively testable and readable without running anything. It
hashes through Web Crypto rather than `node:crypto`, so the same implementation runs in
the browser (where the creator's file is fingerprinted and must never be uploaded), in
the Worker, and in Node.

### The four modules

| Module | Answers |
|---|---|
| `fingerprint.ts` | *What* the work is — CIDv1/raw/sha2-256, computed client-side |
| `milestone.ts` | *When* it was recorded, and *who* wins a priority dispute |
| `proof.ts` | *Whether* a claim verifies, and whether it is chain-anchored |
| `plans.ts` | *Whether* the account may record another registration |

## The API

`GET /` serves the Swagger UI; `GET /openapi.json` serves the schema.

| Route | Auth | Does |
|---|---|---|
| `GET /health` | public | liveness |
| `GET /api/plans` | public | the four tiers, from the module the quota gate reads |
| `GET /api/verify/{cid}` | public | verify a fingerprint; flags contested and unanchored claims |
| `GET /api/projects/{projectId}/timeline` | public | milestones newest first, plus a summary |
| `POST /api/registrations` | **gated** | validates a proposal, then refuses to record it |

The read path is public on purpose — anyone must be able to check a claim without an
account, or the proof is only as good as our word for it.

The write path is not open. `POST /api/registrations` validates a proposal against the
domain rules and then returns **501** rather than recording it, because no authenticated
principal can be resolved yet: a registration is a claim of authorship, and an
unauthenticated endpoint that writes one would let anyone record a claim against anyone's
project. Wiring Auth0 (RS256, `iss`/`aud`, `https://pcg.io/` claims, `pst.*` scope) is
what unblocks it. Signing and on-chain anchoring are separate hard stops that this Worker
never performs.

## Develop

```sh
npm install
npm run dev       # wrangler dev  → http://localhost:8787
npm test          # vitest run
npm run check     # tsc --noEmit && vitest run && bundle the Worker
```

`npm run check` must pass before any surface is called done. It bundles the Worker too,
so a change that type-checks but cannot be deployed still fails.

## Deploy

The Worker deploys as `chanfana-openapi-proofstream`. Before the first deploy, create the
registry KV namespace and put both ids in `wrangler.jsonc`:

```sh
npx wrangler kv namespace create REGISTRY_KV
npx wrangler kv namespace create REGISTRY_KV --preview
npm run deploy
```

Until those ids replace the placeholders, `wrangler deploy` fails on the binding — which
is the intended failure, since the Worker has nothing to read without it.

## Scaffolding a new surface

Invoke the `create-app` skill. It covers the entity-scope questions, the domain APIs to
reuse rather than re-implement, the Alchemy/Pinata endpoint conventions, the test bar, and
the PCG hard stops that halt for human confirmation.

Read `.claude/skills/create-app/references/` directly for the screen specification, the
domain model, and the governance rules.

## Two things worth knowing up front

**Verification never requires an upload.** The fingerprint is computed from the bytes on
the creator's machine. `verifyContent` takes bytes; `verifyCid` takes the resulting CID.

**A proof is an attestation, not a notarization.** ProofStream produces a
blockchain-anchored attestation with real evidentiary weight. A notarial act requires a
commissioned notary — using the wrong word invites a challenge the right word does not.
