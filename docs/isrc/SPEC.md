# ProofStream Auto-ISRC + Provenance — Technical Spec v1.0 (draft)

**Owner:** Pantheon Consulting Group, Inc. · **Product:** ProofStream · **Chain:** Sepolia now (where `ProofStream.sol` lives), Base (8453) for mainnet
**Companion files:** `docs/isrc/openapi.yaml` (endpoints), `contracts/isrc/ISRCRegistryModule.sol` + `contracts/isrc/ProofStreamISRCRegistry.sol` (on-chain), `scripts/isrc-hashing.cjs` (reference hashing), `test/ISRCRegistry.test.cjs`

---

## 1. What this system does

ProofStream gets an ISRC assigned and timestamps the claim. After that, anyone can check the record without trusting ProofStream.

| Authority | Owns |
|---|---|
| IFPI / SoundExchange | The ISRC itself, assigned through IFPI-authorized channels and recorded in SoundExchange's database |
| ProofStream | Who claimed the recording, when, the evidence hashes, and every change after that |
| Base | The tamper-evident timestamp and version order |

ProofStream never mints its own ISRCs and never scrapes SoundExchange. Until direct authorized-channel access is in place, assignment routes to a partner ISRC Manager behind the same API (`route: manager_pool`).

> **Naming:** "CPRS" in internal docs means *Canonical Provenance Record Schema*, our own schema. It is not an IFPI standard, and we don't market it as one.

---

## 2. Pipeline

```
Ingest → Fingerprint → Dedupe → Eligibility → Assign ISRC → Claims → Release/UPC
       → Canonical record → Hash → Pin (IPFS vault) → Anchor (Sepolia → Base) → Verify / Certificate
```

| Stage | Component | Open-source / existing |
|---|---|---|
| Storage | PCG IPFS vault (Kubo + Pinata) | Existing (`pcg-ipfs-vault`) |
| Fingerprint | Chromaprint + AcoustID | Open source |
| Canonical DB | Postgres + append-only `provenance_event` table | Open source |
| Auth | Auth0 MCP Gateway / Token Vault | Existing decision |
| Anchor | `ProofStreamISRCRegistry.sol` (standalone, beside `ProofStream.sol`) | This spec |
| Admin key | Safe 2-of-3 multisig | Open source |
| Human-readable mirror | Notion registry | Existing (`pcg-notion-registry`) |
| Evidence docs | Split sheets / licenses from `music-rights-paperwork` | Existing |

---

## 3. Canonical record

One recording = one ISRC. One release = one UPC/GTIN. One work = one ISWC (when known).

### 3.1 Recording record (hashed into `payload_hash`)

```json
{
  "schema": "ps.cprs.recording/1",
  "isrc": "USSKG2612345",
  "record_version": 0,
  "title": "Example Title",
  "version": "original",
  "language": "en",
  "duration_ms": 201000,
  "audio_hash_sha256": "0x…",
  "fingerprint_id": "acoustid:…",
  "audio_cid": "bafy…",
  "contributors": [{ "name": "Artist Name", "role": "primary_artist", "isni": null }],
  "parent_isrc": null,
  "derivative_type": null,
  "isrc_source": "auto_assignment",
  "isrc_assigned_at": "2026-11-19T07:00:00Z",
  "prev_payload_hash": null
}
```

### 3.2 Rights-claim set (hashed into `claim_hash`)

```json
{
  "schema": "ps.cprs.claims/1",
  "isrc": "USSKG2612345",
  "claims": [
    { "claimant_account_id": "acct_…", "role": "master_owner", "right_type": "master",
      "split_bps": 10000, "territories": ["WW"], "exclusive": true,
      "evidence_hashes": ["0x…split-sheet", "0x…license"] }
  ]
}
```

**Validation:** `split_bps` must total exactly 10,000 within each `right_type`.

### 3.3 Never on-chain

Contracts, split-sheet PDFs, IDs, emails, legal names of non-public parties, and per-person split amounts. These stay encrypted off-chain. Only their sha256 hashes appear, inside `evidence_hashes`, which feed `claim_hash`.

---

## 4. Hashing rules (must match byte-for-byte)

| Value | Formula | Example input |
|---|---|---|
| `isrc_key` | `keccak256(utf8(normalized ISRC))` | `USSKG2612345` |
| `upc_key` | `keccak256(utf8(13-digit GTIN))` | `0036000291452` |
| `payload_hash` | `sha256(JCS(recording record))` | §3.1 |
| `claim_hash` | `sha256(JCS(claims set))` | §3.2 |
| `tracklist_hash` | `sha256(JCS({upc, isrcs:[…ordered]}))` | — |
| Batch leaf | `keccak256(abi.encode(event_type, isrc_key, payload_hash, claim_hash, prev_hash))` | — |

- **JCS** = RFC 8785 JSON Canonicalization Scheme. This replaces ad-hoc "sorted keys, no whitespace," which breaks on number formatting and Unicode escapes.
- **Lone surrogates** in any string or key are rejected (RFC 8785 §3.2.2.2), so every anchored record can be canonicalized by an independent verifier.
- **ISRC normalization:** uppercase, strip hyphens and spaces, then validate `^[A-Z]{2}[A-Z0-9]{3}[0-9]{2}[0-9]{5}$`. The hyphenated form is for display only.
- **UPC:** validate the check digit, then left-pad UPC-A to 13 digits.
- Why both hash functions: sha256 matches IPFS and industry file-hash practice, while keccak256 is cheap on-chain for lookup keys. The verifier must never compare one against the other.

Reference implementation: `scripts/isrc-hashing.cjs` (dependency-free JCS). The tests prove the on-chain `isrcKeyOf()` matches it.

---

## 5. Auto-ISRC flow

### 5.1 Dedupe (runs before every assignment)

| Signal | Rule | Weight |
|---|---|---|
| Audio hash | Exact sha256 match | Decisive |
| Fingerprint | Chromaprint similarity ≥ 0.92 | High |
| Metadata | Title + primary artist + duration ±2s + version, against SoundExchange search + internal index | Medium |

| Outcome | Action |
|---|---|
| `exact_match` | Return existing ISRC, `source: existing_match`, `duplicate_prevented: true` |
| `probable_match` (score ≥ 0.85) | 409 → human review queue. Nothing assigned |
| `metadata_conflict` | 409, plus the `metadata.conflict` webhook. Anchoring is blocked until a person reconciles it |
| `no_match` | Proceed to eligibility |

Thresholds are starting values. Tune them on real catalog data in Sprint 1.

### 5.2 Eligibility

- Requester is the rights owner, or an authorized ISRC Manager for that registrant code
- Title, primary artist, `duration_ms > 0`, and audio present
- The account has passed KYC-lite

### 5.3 Assignment

`POST /v1/recordings/{id}/assign-isrc` with a required `Idempotency-Key`.

- The key and request body are stored for 24h. A replay returns the original response, and a new body under the same key returns 422.
- A DB unique constraint on `(recording_id)` for assigned ISRCs, plus the on-chain `AlreadyRegistered` revert, are the second and third locks against double assignment.
- Responses: `200` assigned or matched · `202` queued to a partner manager (then the `isrc.assigned` webhook) · `409` needs review.

### 5.4 ISRC state machine

```
pending ──assign──▶ assigned ──anchor confirmed──▶ registered
                                                     │  ▲
                                         openDispute │  │ resolveDispute
                                                     ▼  │
                                                   disputed
registered / disputed ──supersede (duplicate cleanup)──▶ superseded   (terminal, never deleted)
```

---

## 6. Anchoring

| Event | Path | Latency |
|---|---|---|
| New ISRC registration | `registerBatch()` every 5–15 min | Batched |
| Metadata correction / claim change | `updateClaim()` in batch window | Batched |
| Release / UPC | `anchorRelease()` | Batched |
| Provenance event log | `anchorBatch(merkleRoot, count, ipfs://…)` | Batched |
| Dispute open | `openDispute()` | **Immediate** |
| Transfer | `proposeTransfer` / `acceptTransfer` | Immediate (user-signed) |

The batcher holds `ISSUER_ROLE` and runs as its own key in the OpenShell sandbox, never the admin key. Confirmation threshold: 10 blocks on Base before `anchor.status = confirmed` and the webhook fires. Store `chain_id`, `tx_hash`, `block_number`, `batch_id`, and `merkle_proof` back in Postgres.

---

## 7. API ↔ contract mapping

| API | Contract call | Signer |
|---|---|---|
| `assign-isrc` (after confirm) | `registerRecording` / `registerBatch` | Issuer (batcher) |
| `PATCH /recordings/{id}` | `updateClaim` | Issuer (on user's behalf) |
| `PUT /claims` | `updateClaim` | Issuer |
| `POST /transfers` | `proposeTransfer` | Claimant wallet (or Safe) |
| `POST /transfers/{id}/accept` | `acceptTransfer` | Buyer wallet |
| `POST /disputes` | `openDispute` | Issuer |
| `POST /disputes/{id}/resolve` | `resolveDispute` | Arbiter |
| Duplicate cleanup (admin tool) | `supersede` | Arbiter |
| `parent_isrc` on create | `linkDerivative` | Issuer |
| `POST /releases` | `anchorRelease` | Issuer |
| `GET /verify` | `verify` (view) | — |
| `GET /verify/{isrc}/history` | `getVersion` + events | — |

**Custodial note:** most indie users won't hold wallets. The default claimant is a ProofStream-managed smart account per customer. Labels and catalog owners can register their own wallet or Safe, and transfers then require their signature.

---

## 8. Verification

`GET /v1/verify?isrc=…` does the following:

1. Normalize the ISRC → compute `isrc_key` → call `verify(isrc_key)` on Base.
2. Load the latest canonical record from the IPFS vault → recompute `sha256(JCS(record))`.
3. `onchain_hash_match = (recomputed == on-chain payloadHash)`.
4. Query SoundExchange's public ISRC search → set `soundexchange_match` to `match`, `conflict`, or `not_checked`.
5. `valid = onchain_hash_match && status != superseded && soundexchange_match != conflict`.

**Public page** (`verify.proofstreamapp.com/isrc/US-SKG-26-12345`): ISRC, title, version, the claimant's public name, assigned date, chain, tx link, status, version timeline with field diffs, and a green check only when `valid`.

**Certificate (PDF):** QR code → verifier URL, payload hash, tx hash, and a fingerprint snippet. Under FRE 902(13)–(14), the certificate is self-authentication support only when paired with a certification from a qualified person. It is cryptographic attestation, not a notarial act.

---

## 9. Edge cases

| Case | Handling |
|---|---|
| Remix / alt version | New recording, new ISRC, `parent_isrc` + `derivative_type` → `linkDerivative` |
| Re-release / remaster of the same audio | Same ISRC, new UPC → new `anchorRelease` |
| Remaster with altered audio | Check the IFPI ISRC Handbook rules for the change made. Default when audio is materially changed: new ISRC, linked as derivative `remaster` |
| Split dispute | `openDispute` freezes transfers and claimant edits; both claims stay visible; the arbiter appends the resolution |
| Catalog sale | Two-step transfer; the buyer's acceptance names the agreement hash they reviewed and reverts if the claimant swapped it; buyer inherits full history; the original assignment event is untouched |
| Bad metadata | `updateClaim` → new version, new hash; the old version stays verifiable; the verifier shows the diff |
| SoundExchange mismatch | `metadata_conflict`, anchoring blocked, human reconciliation |
| Duplicate ISRC found later | Arbiter `supersede(duplicate → survivor)`; the survivor must be live and a record is superseded only once, so links never cycle; the duplicate stays readable and points to the survivor |
| Network retry | Idempotency-Key + DB constraint + on-chain revert |

---

## 10. Security & keys

- **`DEFAULT_ADMIN_ROLE`:** a Safe 2-of-3 multisig, never a single wallet. Admin only grants roles and pauses.
- **`ISSUER_ROLE`:** batcher hot key, rate-limited, rotated quarterly, with no admin powers.
- **`ARBITER_ROLE`:** a separate key, or a separate Safe if arbitration volume grows.
- **No upgradeable proxy.** Immutable logic is the trust argument. Fixes ship as a V2 contract plus an anchored migration event.
- **Audit before mainnet.** Run Slither and Aderyn (open source) first, then a paid audit only after testnet traffic.

---

## 11. Open items

1. **Authorized-channel access:** confirm the auto-assignment service is live, and the application path for an IFPI-authorized channel. This is the subject of the partner one-pager.
2. **Partner ISRC Manager:** pick one for the interim `manager_pool` route.
3. **Cross-link:** add the `ProofStream.sol` regKey/contentHash for the audio file to the canonical recording record, so an ISRC record points to the creator's own timestamp.
4. **Custodial smart accounts:** choose the account standard (ERC-4337 vs. Safe per customer).
5. **Dedupe thresholds:** calibrate on real catalog data.

---

## 12. Build order

| Sprint | Scope | Exit test |
|---|---|---|
| 1 — Core | Ingest, Chromaprint, Postgres + event log, dedupe, hashing lib | Same audio uploaded twice → one recording, `exact_match` |
| 2 — Auto-ISRC | Partner-manager route, idempotent assign, UPC validation, releases | 100 parallel retries → exactly one ISRC |
| 3 — Anchor | Registry deploy to Sepolia, batcher, Merkle batches, verifier page | `GET /verify` returns `onchain_hash_match: true` |
| 4 — Rights | Claims, transfers, disputes, certificates, webhooks, Safe admin, audit | Dispute freezes transfer on-chain; certificate QR resolves |

**Go-to-market wedge:** independent labels and distributors losing royalties to duplicate or missing ISRCs. The pitch is "assign + prove in one click," not "blockchain."
