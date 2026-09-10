# Copilot / Claude Instructions for ProofStream

## Project Overview

**ProofStream** (Pantheon Consulting Group) is on-chain IP timestamping, proof of creation, and witness attestation. Creators register projects, anchor milestones with content hashes + IPFS references, designate witnesses, and collect paid witness attestations. The full system targets Sepolia and Arbitrum Sepolia testnets first.

## Architecture

### Core contract

- **`contracts/ProofStream.sol`** — single contract, Solidity `0.8.20`, inherits **OpenZeppelin v5** `Ownable`, `ReentrancyGuard`, `Pausable`.
  - `Project` struct: `projectId`, `creator`, `createdAt`, `milestones[]`, `isPublic`, `category`
  - `Milestone` struct: `contentHash`, `timestamp`, `title`, `stage`, `ipfsHash`, `isEncrypted`, `witnesses[]`
  - `RegistrationInfo` struct: per-`contentHash` registration lookup
  - Mappings: `projects`, `creatorProjects`, `registrations`, `designatedWitnesses`, `witnessAttestations`
  - Fees: `registrationFee` (default 0.001 ETH) for `createProject` / `registerMilestone`; `witnessAttestationFee` (default 0.001 ETH) for `attestWitness`. Both are owner-settable.

### Front-running mitigation: creator-bound registration key

Every registration is keyed on `_regKey(creator, contentHash) = keccak256(creator, contentHash)`, **not** on `contentHash` alone. Two different creators can independently register the same `contentHash`; neither blocks the other. Front-runners who copy a `contentHash` from the mempool register against their own address — they cannot overwrite or block the original creator's claim.

This means callers must supply a `creator` argument to every read that needs to identify a specific registration (see signatures below).

### Implemented functions

- `createProject(projectId, category, isPublic)` — payable, `whenNotPaused`, returns `bytes32 projectHash`
- `registerMilestone(projectHash, contentHash, title, stage, ipfsHash, isEncrypted)` — payable, `whenNotPaused`, project-creator-only
- `verifyContent(address creator, bytes32 contentHash)` — view, returns `(exists, timestamp)`. Caller supplies the creator they want to verify.
- `addWitness(bytes32 contentHash, address witness)` — `whenNotPaused`, no fee. Creator is `msg.sender` — only the original creator's regKey is touched.
- `attestWitness(address creator, bytes32 contentHash)` — payable, `whenNotPaused`, `nonReentrant`, designated-witness-only
- `getWitnesses(address creator, bytes32 contentHash)` — view, returns full address array
- `verifyWitness(address creator, bytes32 contentHash, address witness)` — view, returns `(attested, attestedAt)`
- `isDesignatedWitness(address creator, bytes32 contentHash, address witness)` — view ergonomic wrapper over the public `designatedWitnesses` mapping (which is keyed on regKey)
- `getCreatorProjects(address creator)` / `getProject(bytes32 projectHash)` — view helpers
- `setRegistrationFee(newFee)` / `setWitnessAttestationFee(newFee)` — `onlyOwner`, emit `RegistrationFeeUpdated` / `WitnessAttestationFeeUpdated`
- `pause()` / `unpause()` — `onlyOwner` wrappers over OZ `_pause()` / `_unpause()`
- `withdraw()` — `onlyOwner`, `nonReentrant`, emits `Withdrawal`
- `receive()` — accepts ETH

### Events

- `ProjectCreated(projectHash, creator, projectId, timestamp)`
- `MilestoneRegistered(projectHash, contentHash, creator, milestoneIndex, timestamp)` — three indexed params; off-chain indexers should group by `(creator, contentHash)` to surface competing-claim scenarios
- `WitnessAdded(contentHash, witness, creator)`
- `WitnessAttested(contentHash, creator, witness, timestamp)`
- `RegistrationFeeUpdated(oldFee, newFee)`
- `WitnessAttestationFeeUpdated(oldFee, newFee)`
- `Withdrawal(to, amount)`
- (OZ) `Paused(account)` / `Unpaused(account)`

### Known limitations (tracked, intentional)

- **`getWitnesses` is unbounded** — gas concern for on-chain consumers if a milestone accumulates many witnesses. Off-chain indexer of `WitnessAttested` is preferred.
- **No EIP-712 signature verification** — all auth is `msg.sender`. Off-chain delegated signing (needed for AI Workers Gateway phase) is a future addition.
- **No IPFS pinning logic on-chain** — `ipfsHash` is stored verbatim; pinning is an off-chain operator concern.
- **No global "did anyone register this hash?" lookup** — by design, since the global index is what enabled front-running. Off-chain indexers walk `MilestoneRegistered` events to answer that.

## Build, test, deploy

```bash
npm run compile      # hardhat compile
npm test             # hardhat test (uses test/ProofStream.test.cjs)
npm run test:coverage
npm run node         # local hardhat node, chainId 31337
npm run deploy:sepolia
npm run deploy:arbitrum
npm run verify:sepolia <address>
npm run verify:arbitrum <address>
```

The deploy script lives at `scripts/deploy.ts` (referenced by `package.json`). An alternative declarative deploy is at `ignition/modules/ProofStream.ts` (Hardhat Ignition).

## Conventions

### Solidity
- Hash generation seeds with `msg.sender`, the relevant ID, and `block.timestamp`:
  ```solidity
  bytes32 hash = keccak256(abi.encodePacked(msg.sender, id, block.timestamp));
  ```
- Fee validation idiom (use **before** state changes):
  ```solidity
  require(msg.value >= registrationFee, "Insufficient fee");
  ```
- Creator-permission idiom:
  ```solidity
  require(projects[hash].creator == msg.sender, "Not project owner");
  ```
- OZ v5 `Ownable` constructor takes the initial owner — `Ownable(msg.sender)` in the constructor body.

### TypeScript / Hardhat
- Tests use **ethers v6** (`test/ProofStream.test.cjs`) — `ethers.getSigners()`, `waitForDeployment()`, Chai assertions.
- `scripts/send-op-tx.ts` uses **viem** via `network.connect({ chainType: "op" })` — different paradigm; do not mix into the ethers tests.
- Format wei for logs with `ethers.formatEther()`; parse input with `ethers.parseEther()`.

## Claude Code automations in this repo

- **Skills**: `.claude/skills/preflight-deploy/` (user-only), `.claude/skills/verify-and-tag/`.
- **Subagents**: `.claude/agents/solidity-security-reviewer.md`, `.claude/agents/deploy-runbook-reviewer.md`.
- **Hooks** (`.claude/settings.json`): blocks `.env*` reads/edits; auto-compiles after edits to `contracts/*.sol`.
- **MCP** (`.mcp.json`): `context7` for live docs of OZ v5 / ethers v6 / Hardhat / viem.
- **Permissions**: project-shared rules in `.claude/settings.json`; per-user overrides in `.claude/settings.local.json`.
- **Operations runbook**: [OPERATIONS.md](../OPERATIONS.md) — submission-side practices (private mempool, sequencer guidance) that complement the contract-level front-running mitigation.

## External integrations

- **OpenZeppelin contracts v5** (`@openzeppelin/contracts@^5.0.0`)
- **Alchemy** RPC for Sepolia + Arbitrum Sepolia
- **Etherscan V2 unified API** for verification — a single `ETHERSCAN_API_KEY` covers Sepolia, Arbitrum Sepolia, and ~50 other chains. Arbiscan still exists as a website but no longer issues its own API keys.
- **IPFS**: off-chain; the contract only stores hashes

## Key file references

- Contract: [contracts/ProofStream.sol](../contracts/ProofStream.sol)
- Tests: [test/ProofStream.test.cjs](../test/ProofStream.test.cjs)
- Deploy (imperative): [scripts/deploy.ts](../scripts/deploy.ts)
- Deploy (declarative): [ignition/modules/ProofStream.ts](../ignition/modules/ProofStream.ts)
- Hardhat config: [hardhat.config.cjs](../hardhat.config.cjs)
- Env template: [.env.example](../.env.example)
- Legacy / archive: [archive/](../archive/), [contracts_backup/](../contracts_backup/), [scripts_backup/](../scripts_backup/) — do **not** import from these
