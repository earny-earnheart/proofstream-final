# Domain model

`src/domain/` is pure: no network, no filesystem, no framework. That purity is deliberate —
these are the rules that decide who owns a work, so they must be exhaustively testable and
readable by someone who is not an engineer.

## Fingerprint (`fingerprint.ts`)

A registration's identity is the **CIDv1 / raw codec / sha2-256 / base32-lower** of the
content bytes — the `bafkrei...` form the notary pipeline records.

```
contentCid(bytes)     → Promise<"bafkrei...">   canonical identity
sha256Hex(bytes)      → Promise<"0x...">        display only, never a key
isContentCid(value)   → boolean                 structural check, says nothing about registration
digestFromCid(cid)    → Uint8Array              re-hash and compare, for independent verification
base32Encode/Decode                             RFC 4648, lowercase, unpadded (multibase `b`)
toHex(bytes)                                    runtime-agnostic hex, no Buffer
```

Hashing goes through **Web Crypto**, which is why the two hashing functions are async.
That is the price of one implementation that runs in the browser, the Worker, and Node —
and the browser is not optional here, because the Verify screen fingerprints the creator's
file locally and must never upload it. `verifyContent` takes bytes rather than a path or
an upload handle for the same reason.

Do not add a synchronous `node:crypto` variant for server use. Two implementations of a
fingerprint is two answers to "what is this work's identity".

`isContentCid` is a *shape* check. It answers "is this a fingerprint", never "is this
registered" — conflating the two is how an unregistered work gets shown as verified.

## Projects and milestones (`milestone.ts`)

A `Project` is owned by a wallet address and holds `Milestone`s. Each milestone carries a
`stage` (`draft` / `revision` / `final`), a `cid`, an ISO instant, and witness addresses.

- `validateMilestone` returns **every** error, not the first — the Register form shows them
  together.
- `isIsoInstant` requires a full instant with a timezone designator. A bare calendar date
  is rejected: priority turns on the *order* of two registrations, and `Date.parse` would
  silently invent the missing precision.
- `isWalletAddress` is a 20-byte hex shape check. EIP-55 checksum validation is not done
  here; add it at the wallet boundary if needed.
- `buildTimeline` sorts newest-first and breaks ties on id, so the render order is stable
  across reloads. It copies rather than sorting in place.
- `summariseTimeline` counts each witness once regardless of address casing.

### First in time

`firstInTime(cid, milestones)` implements the priority rule the whole product rests on:
of every registration of a fingerprint, the earliest wins.

**On an exact timestamp tie it returns no winner and both claims as `contested`.** This is
intentional. The system does not invent a tiebreak — insertion order, id, or wallet address
are all arbitrary, and an arbitrary answer to a priority dispute is worse than an escalation.
Code that consumes this must handle `winner === null` rather than reaching for `contested[0]`.

## Proofs (`proof.ts`)

The `ProofObject` is the receipt — what a creator hands a court or a counterparty. Its shape
is fixed by the notary pipeline, so changing it breaks everyone holding an older certificate.

```
cid, signer, date, eip712Signature      required
anchorTx, anchorChainId, agentId,       optional
gatewayUrl
```

- An EIP-712 signature is 65 bytes: r (32) + s (32) + v (1).
- `anchorTx` without `anchorChainId` is **rejected** — a transaction hash with no chain is
  not verifiable by anyone.
- `isAnchored` separates a chain-anchored timestamp from one that rests on trusting the
  pinning service. The UI must show the difference; they are not equally strong claims.

`verifyCid` / `verifyContent` back the Verify screen and return one of three statuses:
`verified`, `unregistered`, `invalid-input`. Unregistered is a truthful answer, not an
error. When a fingerprint has been registered more than once, the **earliest** claim is
returned — the same first-in-time rule, applied at the lookup.

## Plans (`plans.ts`)

Four tiers transcribed from the landing screen: free ($0, 5/mo), creator ($10, 50/mo),
professional ($25, unlimited, API), studio ($100, unlimited, API, seats).
`monthlyRegistrations: null` means unlimited.

`checkRegistrationQuota` **fails closed**: usage above the cap returns `allowed: false`
with `remaining: 0` rather than a negative allowance, so a mid-month downgrade cannot hand
out credit. Non-integer and negative usage counts are rejected rather than coerced.

This file is the single source of truth for both the pricing copy and the gate. Changing
one without the other is a billing defect, not a cosmetic one.
