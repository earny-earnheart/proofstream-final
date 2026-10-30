# ProofStream institutional bond — implementation and handoff

## Current result

A concrete testnet ledger is implemented. Nothing has been publicly deployed or
issued. Local Hardhat tests deploy and exercise the actual contracts. The original
ProofStream IP registration contract is unchanged.

| Component | Implementation |
| --- | --- |
| Certificate ledger | `ProofStreamBond`: pinned Solv ERC-3525 1.5.0, two value decimals |
| Identity | `InstitutionalIdentityRegistry`: administrator-attested identity with expiry/revocation |
| Eligibility | `QIBTransferPolicy`: verified identity, QIB expiry, freeze and pause |
| Collateral | `CollateralRegistry`: EIP-712 assertions, EOA/ERC-1271 signers, nonce/revision controls |
| Monitoring | Finalized-block reader, expiry ticklers, exact-integer daily deficiencies, persistent outbox |
| Deployment | Browser MetaMask signing helper, testnet-only chain checks, receipt checkpoints, artifact export |

These registries implement the required application interfaces; they are not a full
T-REX deployment, ONCHAINID claim system, or certification of ERC-3643 compliance.
No RPC credentials or private keys are needed to run the local suite.

## Local commands

```sh
npm ci
npm test
npm run test:coverage
# Coverage instruments the build. Rebuild clean before exporting deployment artifacts:
npm run clean
npm run bond:export
```

Export writes `artifacts/bond-bundle/contracts.json` containing the four production
contracts' ABIs and creation bytecode. Test doubles are excluded. `package-lock.json`
pins dependencies; Solidity is compiled using the pinned npm solc 0.8.20 package.

## Token lifecycle and authority

Each slot represents immutable series terms: terms-document hash, ISO-style uppercase
currency code, maturity and maximum cumulative issuance. Face values are integers in
hundredths of that currency. No currency or principal amount is preconfigured.
Series terms are commitments to external documents, not executable coupon schedules.

- Governance is an immutable address, intended to be a governed multisig. It can
  grant/revoke issuer and trustee roles. It cannot be rotated within this contract;
  governance signer rotation must occur inside the chosen multisig.
- Issuers create series and issue certificates to eligible wallets, using unique
  transaction-reference hashes. Total issuance cannot exceed the cap and cannot
  occur at/after maturity. Redemption does not reopen the cap.
- Owners and approved operators transfer certificates or same-slot value. Transfers
  to addresses create new IDs (splits); transfers into existing IDs consolidate
  value (merges). Empty IDs remain after a full value transfer, per the base model.
- The common pre-transfer hook covers both value-transfer overloads, all certificate
  transfer overloads, minting, partial burns and full burns. Revocation or pause is
  checked when a transfer executes, not merely when approval is granted.
- A trustee records partial/full redemption with a unique settlement reference.
  **This burns face value; it does not pay cash or prove payment happened.** Frozen
  or expired source eligibility blocks redemption; recover to an eligible wallet first.
- Trustee recovery preserves ID, slot and face value. It can bypass the source's
  eligibility, but cannot bypass destination eligibility or global pause. It clears
  certificate/value approvals and emits an order hash. It deliberately does not call
  receiver callbacks: the trustee must validate the destination's custody capability.
- Value-approval history is capped at 64 distinct addresses between certificate
  transfers, preventing unbounded cleanup gas. Zero allowances still occupy a history
  entry until certificate transfer/recovery. An outsider cannot create zero-value
  allowances by transferring zero. All transfer routes reject accidental ETH;
  approvals may be changed while paused, but cannot bypass execution checks.

Minting is non-safe under the selected base implementation; onboarding must verify
contract-wallet custody compatibility. Imported ERC-3525 value receiver semantics
are retained: ERC-3525 receiver checks are conditional on advertised interface support.
Callback reentry into transfers, issuance, redemption and recovery is guarded.

Identity and collateral registry ownership uses two-step transfer. QIB policy uses
Ownable's single-step ownership transfer. Operational administrators should be governed
accounts. Onboarding evidence stays off chain; only hashes and expiry dates are public.

## Collateral attestations and monitoring

`CollateralRegistry.submit` accepts a relayed, signed `CollateralAttestation` with:
LOC ID, expiry, sequential revision, eligible/required balances, currency, document
hash, locator hash (e.g. hash of the exact IPFS CID string), observation time, signature
deadline and signer nonce. `scripts/collateral-signing.mjs` defines the exact typed data.
The domain includes chain ID and registry address. Contract signatures use ERC-1271.

Authorized signers must supply a fresh observation (within one hour of submission).
The registry rejects reused nonces, out-of-order revisions, future/older observations,
expired signatures and currency changes. The document hash must be independently
verified against retrieved document bytes by the ingestion process: the contract cannot
retrieve documents or prove that a signed bank balance is true. Attestor revocation
stops new submissions; it does not invalidate already stored observations automatically.

A valuation update increments revision; changing expiry starts a new expiry-reminder
cycle. Ordinary valuation updates do not resend reminders. All balances for a LOC
must use identical currency/units; the upstream process must apply eligibility,
haircuts, allocation and FX rules. Do not duplicate pooled obligations across LOCs.
There is no automatic coupling between bond supply and collateral requirements:
required balances are attestor assertions until the final collateral model is specified.

Run from a single scheduler against persistent local storage:

```sh
node scripts/collateral-monitor.mjs --rpc /data/registry.json /data/outbox.json
# Or use an explicit locally produced snapshot:
node scripts/collateral-monitor.mjs --snapshot /data/snapshot.json /data/outbox.json
```

The RPC mode reads `SEPOLIA_RPC_URL` from the process environment. It does not load
`.env` files. Configure the runtime binding, expected chain and registry:

```json
{"chainId":11155111,"registry":"0x...","locIds":["0x...32-byte LOC ID..."]}
```

Snapshot schema (replace example timestamps with current Unix seconds):

```json
{
  "observedAt": 1800000000,
  "locs": [{
    "id": "LOC-1", "revision": 1, "expiry": 1810368000,
    "observedAt": 1800000000, "currency": "EUR",
    "eligibleBalance": "95000000", "requiredBalance": "100000000"
  }]
}
```

The RPC adapter reads a common finalized block and checks chain identity and block
consistency. It rejects blocks older than one hour and LOC observations older than
24 hours. These are operational defaults requiring agreement before production.
Snapshot mode trusts the producer; it does not verify signatures.

Reminders catch up crossed 120/90/60/30-day milestones once per LOC/expiry. Expired
LOCs contribute zero eligible value. Deficiencies are recorded once per UTC day per
LOC/expiry; an intra-day worsening deficiency is not separately alerted. State keys
have changed from the original prototype: use a fresh test outbox when upgrading.

The output is a pending-alert outbox, not delivered notices. No email, SWIFT or
webhook sender is installed. Integrate acknowledged delivery/retries before relying
on contractual notices. The single-host lock prevents overlapping runs; remove a
stale lock only after confirming its process is dead. Atomic rename protects JSON
writes, but is not a database transaction or power-loss durability guarantee. Alert on
nonzero exit and overdue `lastSuccessfulRun` in an external scheduler. Nothing is
running persistently in this cloud session.

## MetaMask / Alchemy handoff

`scripts/bond-deployment.mjs` is an integration module for an existing browser app or
bundler; it is not a hosted wallet UI. Call `deployWithMetaMask` with the selected
EIP-1193 wallet provider, exported artifacts, roles, expected testnet chain ID and a
persistent checkpoint callback. The wallet signs locally. No key export is involved.
The helper checks network identity before each deployment and records transaction
hashes before confirmation, then confirmed addresses, constructor arguments, runtime
hashes and gas usage. Persist submitted records too: a later wallet rejection must
not lose earlier transactions. Partial deployments require reconciliation before retry;
the helper does not automatically resume or verify explorer source.

Only chain IDs 31337, 11155111 and 421614 are accepted. Actual MetaMask and public RPC
interaction remain untested because credentials/browser-wallet access are unavailable.
Local deployment orchestration has been tested using the same helper with a signer.
The helper deploys empty registries and no bond series, investors, collateral or supply.

Before public testnet deployment:

1. Supply public governance, compliance, issuer and trustee addresses and choose the
   testnet. Configure Alchemy access and its exact hostname in the Cloud Environment
   network policy. Never paste private keys or seed phrases into chat.
2. Review the contracts and dependency findings. Complete the security, gas and
   coverage review gates documented in `CLAUDE.md`; this implementation session and
   its automated tests are not those independent approvals or an external audit.
3. Clean-build/export artifacts, record source revision, review each wallet request,
   persist receipts and verify deployed source/bytecode. Preserve append-only deployment
   history; do not publish local ephemeral addresses as live deployments.
4. Onboard test identities/QIB eligibility, authorize attestors, set approved series
   terms and exercise a full test issuance/recovery/redemption/monitoring cycle.

The existing `deploy:sepolia` command still deploys only the IP-registration contract
using a server key. It is not the bond-suite or MetaMask deployment command.

## Legal and institutional dependencies remain explicit

- Rule 144A is a resale safe harbor, not the issuer's initial-offering exemption.
  Counsel must determine the issuance exemption, eligible instruments, distribution
  restrictions and information rights. A QIB registry is only an operational control.
- Article 12 control does not automatically perfect a lien or confer blanket priority
  over an underlying asset. Instrument classification (including Article 8 exclusions),
  Article 9 attachment/perfection, jurisdiction and qualifying-purchaser rules matter.
  An IP hash does not assign IP rights or perfect an IP lien.
- UK ETDA applicability and reliable-system requirements must be assessed for the
  actual document. Trustee recovery powers need reconciliation with exclusive control.
- Contractual TIA-style covenants do not establish an exemption or guarantee a rating.
  Neither token standards nor ERC-8004 agent identities establish legal enforceability.
- EIP-712 binds typed assertions to a configured domain; timestamps remain assertions.
  Bank receipt, documentary compliance and payment are distinct from chain inclusion.
- eUCP does not universally mandate one platform, PDF/A or X.509. Agree the formats,
  authentication, presentation endpoint and completeness process with the banks.
  See the separate MT700 draft; its licensed ICC citations require verification.
- No Clearstream D7, Euroclear D-FMI, bank LOC feed, cash/coupon engine, automated
  statutory accounting, sustainable-use-of-proceeds reporting, or agent registry
  integration is implemented. Those need the selected counterparties and specifications.

The executable ledger can be tested now; institutional issuance still requires executed
legal documents, approved economic terms, custody/settlement arrangements and audits.
These constraints are architectural guidance, not a legal opinion. Primary starting
points: [Rule 144A](https://www.ecfr.gov/current/title-17/chapter-II/part-230/section-230.144A),
[UK ETDA](https://www.legislation.gov.uk/ukpga/2023/38/contents),
[EIP-712](https://eips.ethereum.org/EIPS/eip-712). Current legal applicability and ICC
text have not been independently verified in this session.
