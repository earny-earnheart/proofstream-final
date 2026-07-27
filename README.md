# ProofStream

Blockchain-anchored proof of creation. Register a work, track its creative timeline, and
establish who was **first in line, first in time**.

ProofStream is the PST subsidiary scope under Pantheon Consulting Group. Governing law:
Wyoming.

## What is here

This repository currently holds the **domain layer** — the pure rules that decide
authorship — plus the `create-app` skill that keeps new surfaces on those rules.

```
src/domain/          fingerprinting, milestones, proofs, plans (no network, no framework)
tests/               101 tests over the domain layer
.claude/skills/
  create-app/        scaffolding skill for new ProofStream surfaces
```

The domain layer is deliberately dependency-free and pure. These are the rules a dispute
turns on, so they are exhaustively testable and readable without running anything.

### The four modules

| Module | Answers |
|---|---|
| `fingerprint.ts` | *What* the work is — CIDv1/raw/sha2-256, computed client-side |
| `milestone.ts` | *When* it was recorded, and *who* wins a priority dispute |
| `proof.ts` | *Whether* a claim verifies, and whether it is chain-anchored |
| `plans.ts` | *Whether* the account may record another registration |

## Develop

```sh
npm install
npm test          # vitest run
npm run check     # tsc --noEmit && vitest run
```

`npm run check` must pass before any surface is called done.

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
