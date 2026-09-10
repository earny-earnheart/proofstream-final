# ProofStream

Blockchain-anchored proof of creation. Register a work, track its creative timeline, and
establish who was **first in line, first in time**.

ProofStream is the PST subsidiary scope under Pantheon Consulting Group. Governing law:
Wyoming.

## Layout

Two independent packages, each with its own `package.json`, `tsconfig.json`, and
`node_modules`. There is no workspace root and no shared lockfile — see
[worker/README.md](worker/README.md#develop) for why.

| Path | What | Toolchain |
|---|---|---|
| `contracts/`, `scripts/`, `test/` | `ProofStream.sol` — paid project creation, milestone registration, witness attestation | Hardhat, Solidity 0.8.20, OpenZeppelin v5 |
| [`worker/`](worker/) | The domain layer and the OpenAPI Worker that serves it | wrangler, Hono + chanfana, vitest |
| `.claude/skills/create-app/` | Scaffolding skill for new ProofStream surfaces | — |

The root `package.json` is the contracts package: `npm test` and `npm run deploy:sepolia`
at the repository root drive Hardhat. The Worker's commands run from `worker/`.

## Contracts

Everything on-chain is keyed on `regKey = keccak256(creator, contentHash)`, never on the
content hash alone, so two creators may register the same hash independently and a copier
cannot front-run a hash claim. `verifyContent(creator, hash)` answers "did *this creator*
register this hash"; "did *anyone*" is answered off-chain by walking
`MilestoneRegistered` events.

```sh
npm install
npm run compile
npm test                  # Mocha/Chai
npm run deploy:sepolia
```

Deployment history is the source of truth in `deployments/<network>.json` (append-only
`history`); `deployments/<network>.abi.json` mirrors the latest deploy. See
[CLAUDE.md](CLAUDE.md) for the invariants, the deploy lifecycle, and the review gates.

## Worker

The pure rules that decide authorship — fingerprinting, milestone ordering, priority
disputes, proof verification, plan quotas — plus the Cloudflare Worker that serves them
over OpenAPI. The read path is public; the write path validates and then refuses, because
no authenticated principal can be resolved yet.

```sh
cd worker
npm install
npm run check             # tsc --noEmit && vitest run && bundle the Worker
```

Full detail, including the route table and the KV setup, is in
[worker/README.md](worker/README.md).

## Scaffolding a new surface

Invoke the `create-app` skill. It covers the entity-scope questions, the domain APIs to
reuse rather than re-implement, the Alchemy/Pinata endpoint conventions, the test bar, and
the PCG hard stops that halt for human confirmation.

Read `.claude/skills/create-app/references/` directly for the screen specification, the
domain model, and the governance rules.

## Two things worth knowing up front

**Verification never requires an upload.** The fingerprint is computed from the bytes on
the creator's machine.

**A proof is an attestation, not a notarization.** ProofStream produces a
blockchain-anchored attestation with real evidentiary weight. A notarial act requires a
commissioned notary — using the wrong word invites a challenge the right word does not.
