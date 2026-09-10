import { contentCid, isContentCid } from "./fingerprint.js";
import { isIsoInstant, isWalletAddress, type Milestone, type Project } from "./milestone.js";

/**
 * The proof object is ProofStream's receipt: the thing a creator hands a court, a
 * label, or a counterparty. Its shape is fixed by the notary pipeline
 * (fingerprint → custody → attestation → anchor), so treat changes here as
 * breaking for anyone holding an older certificate.
 */

export interface ProofObject {
  cid: string;
  signer: string;
  /** ISO 8601 instant of first upload — the attestation is bound to it */
  date: string;
  eip712Signature: string;
  anchorTx?: string;
  anchorChainId?: number;
  agentId?: number;
  gatewayUrl?: string;
}

const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** An EIP-712 signature is 65 bytes: r (32) + s (32) + v (1). */
export function isEip712Signature(value: string): boolean {
  return SIGNATURE_PATTERN.test(value);
}

export function isTransactionHash(value: string): boolean {
  return TX_HASH_PATTERN.test(value);
}

export function validateProofObject(proof: ProofObject): string[] {
  const errors: string[] = [];

  if (!isContentCid(proof.cid)) {
    errors.push("cid must be a CIDv1/raw/sha2-256 fingerprint");
  }
  if (!isWalletAddress(proof.signer)) {
    errors.push("signer must be a 20-byte hex address");
  }
  if (!isIsoInstant(proof.date)) {
    errors.push("date must be an ISO 8601 instant");
  }
  if (!isEip712Signature(proof.eip712Signature)) {
    errors.push("eip712Signature must be 65 bytes of hex");
  }
  if (proof.anchorTx !== undefined && !isTransactionHash(proof.anchorTx)) {
    errors.push("anchorTx must be a 32-byte transaction hash");
  }
  if (proof.anchorTx !== undefined && proof.anchorChainId === undefined) {
    errors.push("anchorChainId is required whenever anchorTx is present");
  }
  if (proof.anchorChainId !== undefined && !Number.isInteger(proof.anchorChainId)) {
    errors.push("anchorChainId must be an integer");
  }

  return errors;
}

/**
 * An unanchored proof still carries a signature and a pinning date, but its timestamp
 * depends on trusting the pinning service. Anchoring is what makes it independent —
 * the Verify screen must not present the two as equivalent.
 */
export function isAnchored(proof: ProofObject): boolean {
  return proof.anchorTx !== undefined && proof.anchorChainId !== undefined;
}

export type VerificationStatus = "verified" | "unregistered" | "invalid-input";

export interface VerificationResult {
  status: VerificationStatus;
  /** Present only when status is "verified" */
  registration?: {
    cid: string;
    registeredAt: string;
    creator: string;
    projectName: string;
    projectCategory: string;
    milestoneTitle: string;
    milestoneStage: Milestone["stage"];
    anchorTx?: string;
    anchored: boolean;
  };
  /** Why the lookup could not be satisfied */
  detail?: string;
}

export interface RegistryEntry {
  milestone: Milestone;
  project: Project;
  proof: ProofObject;
}

/**
 * Back the Verify screen: given a CID, say whether the registry holds it and, if so,
 * what it proves. Callers who start from a file should hash it locally with
 * `contentCid` and pass the result — the bytes never need to be uploaded to verify.
 */
export function verifyCid(cid: string, registry: readonly RegistryEntry[]): VerificationResult {
  if (!isContentCid(cid)) {
    return { status: "invalid-input", detail: "not a CIDv1/raw/sha2-256 fingerprint" };
  }

  const matches = registry.filter((entry) => entry.milestone.cid === cid);
  if (matches.length === 0) {
    return { status: "unregistered", detail: "no registration found for this fingerprint" };
  }

  const earliest = matches.reduce((best, entry) =>
    Date.parse(entry.milestone.recordedAt) < Date.parse(best.milestone.recordedAt) ? entry : best,
  );

  return {
    status: "verified",
    registration: {
      cid,
      registeredAt: earliest.milestone.recordedAt,
      creator: earliest.proof.signer,
      projectName: earliest.project.name,
      projectCategory: earliest.project.category,
      milestoneTitle: earliest.milestone.title,
      milestoneStage: earliest.milestone.stage,
      anchorTx: earliest.proof.anchorTx,
      anchored: isAnchored(earliest.proof),
    },
  };
}

/** Verify a file the caller holds, without uploading it. */
export async function verifyContent(
  content: Uint8Array,
  registry: readonly RegistryEntry[],
): Promise<VerificationResult> {
  return verifyCid(await contentCid(content), registry);
}
