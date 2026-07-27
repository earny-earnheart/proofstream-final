# Screens

Transcribed from `proofstream_userflow.tsx`, the wireframe that defines the product surface.
Seven screens, reachable in this order. Where the wireframe and this file disagree, this
file is the specification — the wireframe is a sketch and carries known defects (noted below).

## 1. Landing

Public. Sells the promise and the price.

- Headline: "Protect Your Creative Work **Before You Share It**".
- Three value props: instant timestamping, legal protection, collaboration proof.
- Pricing block — four tiers. **These numbers come from `src/domain/plans.ts`.** Do not
  hard-code them into the page; the marketing copy and the quota gate must not drift.
- Primary CTA → Onboarding. Secondary CTA → demo.

## 2. Onboarding

Wallet connection. MetaMask and WalletConnect.

The connected address becomes the creator identity on every later proof, so it is not a
cosmetic step. Validate with `isWalletAddress` before persisting anything against it.
The wireframe's "Continue" button advances regardless of connection state — real
onboarding must not.

## 3. Dashboard

Two actions: create a project, or verify content. Keep it two. The dashboard is the fork
between *producing* proof and *checking* proof, and the second is usable by people who
have no account at all.

## 4. Create Project

Name, plus category (the wireframe shows "Music" on the timeline but only collects a name —
collect the category here rather than inferring it later). Owner is the connected address.
On success → Timeline for the new project.

## 5. Register Milestone

The write path. File upload → fingerprint → stage → optional witnesses → register.

- Hash the file **locally** with `contentCid`. The bytes are pinned, but the identity is
  computed client-side.
- Stage is one of `draft` / `revision` / `final`.
- Witnesses are wallet addresses; duplicates (in any casing) are rejected.
- Check `checkRegistrationQuota` *before* the upload, not after — a creator should not
  watch a file upload only to be told they are out of registrations.
- Validate with `validateMilestone` and show every error at once.

## 6. Timeline

The project's creative history, **newest first** — the wireframe shows the final mix above
the revision above the first draft. Use `buildTimeline`; do not sort at the call site.

Per milestone: title, timestamp, stage badge, description, fingerprint, witness count.
Stage colours in the wireframe: draft purple, revision blue, final green.

The fingerprint is displayed truncated (`0x8f7d...a2b3`) but must be copyable in full —
a truncated hash is not evidence.

## 7. Verify

Public, and the most important screen. Anyone can check a claim without an account.

- Accepts a dropped file (hashed locally — "we will generate the hash locally") or a
  pasted fingerprint.
- Backed by `verifyContent` / `verifyCid`.
- Three outcomes, visually distinct: **verified**, **unregistered**, **invalid input**.
  The wireframe only draws the success state. "Not registered" is not an error and must
  not be styled as one; it is a legitimate, common, and truthful answer.
- On success show: registration date, creator address, project and milestone, and the
  anchor transaction.
- **Show whether the proof is anchored.** `isAnchored()` distinguishes a chain-anchored
  timestamp from one that rests on trusting the pinning service. Presenting the two
  identically overstates what the proof establishes.
- "Download Certificate" renders the proof object. It describes an *attestation*, never a
  *notarization*.

## Known defects in the wireframe

Carried here so they are not faithfully reproduced:

- The creator address `0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb` is 39 hex characters.
  A valid address is 40. Any fixture copied from the wireframe will fail
  `isWalletAddress` — this is the validator working, not a bug.
- Displayed hashes are `0x...` truncations. The registry's identifier is a CIDv1
  (`bafkrei...`); the `0x` form is a display convenience, not the key.
- "Continue" on Onboarding and both form buttons advance without validation.
- The pricing tier at $10/mo is labelled only "Most Popular"; its id is `creator`.
