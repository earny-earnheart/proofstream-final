# ProofStream Contracts

On-chain IP timestamping: paid project creation, milestone registration with content hashes + IPFS references, and witness attestation. Single contract, [contracts/ProofStream.sol](contracts/ProofStream.sol) (Solidity 0.8.20, OpenZeppelin v5: Ownable, ReentrancyGuard, Pausable).

## Commands

| Command | Purpose |
| ------- | ------- |
| `npm run compile` | Hardhat compile |
| `npm test` | Mocha/Chai suite |
| `REPORT_GAS=true npm test` | Suite plus per-method gas table |
| `npm run test:coverage` | solidity-coverage |
| `npm run deploy:sepolia` / `deploy:arbitrum` | Deploy via scripts/deploy.ts |
| `npm run verify:sepolia` / `verify:arbitrum` | Etherscan V2 verify (one key, all chains) |

The repo is ESM (`"type": "module"`), which is why the Hardhat config is `.cjs` and the test file is `test/ProofStream.test.cjs`. Keep new test files `.cjs`.

## Contract invariants — do not break these

- **Creator-bound registration keys.** Everything is keyed on `regKey = keccak256(creator, contentHash)`, never on `contentHash` alone. Two creators can register the same hash independently; a copier cannot front-run a hash claim. Any new mapping touching registrations must use `_regKey`.
- **Fee model.** `createProject` and `registerMilestone` require `msg.value >= registrationFee`; `attestWitness` requires `>= witnessAttestationFee`. Overpayment is kept, never refunded — do not add refund logic casually (reentrancy surface).
- **Pause semantics.** All user state-mutations are `whenNotPaused`. `withdraw`, fee setters, `pause`/`unpause` are intentionally exempt.
- **Witness flow.** `addWitness` is free and creator-only (implicitly, via regKey derivation from `msg.sender`); `attestWitness` is paid, witness-only, once per witness.
- **`verifyContent(creator, hash)`** answers "did *this creator* register this hash" — "did *anyone*" is answered off-chain by walking `MilestoneRegistered` events.

## Deploy lifecycle

`/preflight-deploy <network>` → `npm run deploy:<network>` → `/verify-and-tag <network> <address>` → `/export-abi <network>`

Deployment history is the source of truth in `deployments/<network>.json` (append-only `history` array); `deployments/<network>.abi.json` always mirrors the latest deploy. Networks: sepolia (11155111), arbitrum-sepolia (421614).

## Review gates

Run the `solidity-security-reviewer`, `gas-optimizer`, and `coverage-auditor` agents before any deploy. They report findings only; fixes are separate changes.

## Secrets

`.env`, `*.env.local`, and `PINATA_JWT*` hold live keys. Never read, edit, print, or stage them (settings.json denies this; .gitignore excludes them). `.env.example` documents the required keys.
