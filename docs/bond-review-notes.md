# Implementation review and validation notes

This is an implementation self-review, not an independent security audit or completion
of the repository's pre-public-deployment review gates.

## Executed validation

- 80 tests pass, including the unchanged IP-registration tests, real token transfers,
  local suite deployment, EIP-712/1271 submissions and registry-to-monitor integration.
- Solidity coverage: new `contracts/bond/` files have 100% statements, functions and
  lines, and 81.62% branches. Overall application coverage is 100% lines and 84.5%
  branches. Imported dependency internals are not instrumented. Coverage does not
  establish absence of vulnerabilities or full ERC conformance.
- `npm audit --omit=dev`: zero known advisories returned for the production dependency
  graph at execution time. This does not assess contract logic or development tooling.
- Deployment artifacts are clean-built after instrumentation and exclude test doubles.
- `git diff --check` verifies patch whitespace.

## Review findings addressed

1. A check-only adapter did not enforce the token lifecycle. The concrete token now
   invokes policy from the base implementation's common pre-value-transfer hook,
   covering value and certificate transfers, issuance and burns.
2. The ERC-3525 base clears a growing approval array during transfer/burn. Cap distinct
   approval history at 64 between certificate transfers; test recovery at that limit.
   Block stranger zero-value allowance spending that could grow that list.
3. Receiver callbacks could reenter mutation routes. Guard all transfer routes and
   privileged issue/redeem/recover methods, and test callback rejection/rollback.
4. A frozen or lost source wallet needed recovery. Add trustee-only recovery with a
   unique order hash, destination eligibility, pause enforcement and approval clearing.
   No receiver callback runs while the source-eligibility exception is active.
5. A fresh block could contain an old valuation. Monitor record observation time as
   well as block time. Do not resend expiry notices on ordinary valuation revisions.
6. EIP-712 alone did not prevent replay. Check signer authorization, domain, nonce,
   signature deadline, sequential revision and observation ordering.

## Remaining review scope

- Review imported ERC-3525 implementation and nested OpenZeppelin v4 dependencies;
  the application uses pinned OpenZeppelin v5.0.2 separately. These are non-upgradeable
  contracts. Confirm standard conformance and actual custodian receiver compatibility.
- Authority concentration is explicit: issuers mint within a cap, trustees record
  settlement/recovery, compliance admins attest identity/QIB, governance appoints roles
  and collateral attestors assert balances. Use approved multisigs and procedures.
- Governance is immutable; recovery references are hashes, not verified court orders.
  No two-party approval or timelock is enforced. Confirm operational requirements.
- Redemption records no cash transfer. Monitoring trusts authenticated valuation data;
  it does not prove bank liabilities, allocations, legal eligibility or statutory credit.
- Review on-chain metadata privacy, approval-cap economics, all deployment constructor
  addresses and gas under the selected target chain before signing public transactions.
- Actual MetaMask/provider behavior, public-chain finality and bank/notice integrations
  have not been exercised. The local finality integration test maps finalized to a
  mined local block; production code never silently downgrades the finalized tag.
