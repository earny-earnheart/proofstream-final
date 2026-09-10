import { describe, expect, it } from "vitest";
import { contentCid } from "../src/domain/fingerprint.js";
import type { Milestone, Project } from "../src/domain/milestone.js";
import {
  isAnchored,
  isEip712Signature,
  isTransactionHash,
  validateProofObject,
  verifyCid,
  verifyContent,
  type ProofObject,
  type RegistryEntry,
} from "../src/domain/proof.js";

const utf8 = (text: string) => new TextEncoder().encode(text);

const SIGNER = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0";
const SIGNATURE = `0x${"ab".repeat(65)}`;
const TX_HASH = `0x${"cd".repeat(32)}`;

const TRACK_3 = utf8("track-3-first-draft");
const TRACK_3_CID = await contentCid(TRACK_3);
const OTHER_CID = await contentCid(utf8("someone-elses-song"));

function proof(overrides: Partial<ProofObject> = {}): ProofObject {
  return {
    cid: TRACK_3_CID,
    signer: SIGNER,
    date: "2024-10-20T11:23:00.000Z",
    eip712Signature: SIGNATURE,
    anchorTx: TX_HASH,
    anchorChainId: 8453,
    ...overrides,
  };
}

const PROJECT: Project = {
  id: "p1",
  name: "Summer Album 2024",
  category: "Music",
  owner: SIGNER,
  createdAt: "2024-10-15T00:00:00.000Z",
};

const MILESTONE: Milestone = {
  id: "m1",
  projectId: "p1",
  title: "Track 3 First Draft",
  stage: "draft",
  cid: TRACK_3_CID,
  recordedAt: "2024-10-20T11:23:00.000Z",
  witnesses: [],
};

const REGISTRY: RegistryEntry[] = [
  { milestone: MILESTONE, project: PROJECT, proof: proof() },
];

describe("signature and hash shapes", () => {
  it("accepts a 65-byte EIP-712 signature", () => {
    expect(isEip712Signature(SIGNATURE)).toBe(true);
  });

  it.each([
    ["a 64-byte signature missing v", `0x${"ab".repeat(64)}`],
    ["a transaction hash", TX_HASH],
    ["no 0x prefix", "ab".repeat(65)],
  ])("rejects %s as a signature", (_label, value) => {
    expect(isEip712Signature(value)).toBe(false);
  });

  it("accepts a 32-byte transaction hash and rejects a truncated one", () => {
    expect(isTransactionHash(TX_HASH)).toBe(true);
    expect(isTransactionHash("0x8f7d3e2a1b9c4d5e")).toBe(false);
  });
});

describe("validateProofObject", () => {
  it("accepts a complete anchored proof", () => {
    expect(validateProofObject(proof())).toEqual([]);
  });

  it("accepts an unanchored proof that omits both anchor fields", () => {
    const unanchored = proof({ anchorTx: undefined, anchorChainId: undefined });
    expect(validateProofObject(unanchored)).toEqual([]);
  });

  it("rejects an anchor transaction with no chain id, which would be unverifiable", () => {
    const errors = validateProofObject(proof({ anchorChainId: undefined }));
    expect(errors).toContain("anchorChainId is required whenever anchorTx is present");
  });

  it("rejects a signer that is not a wallet address", () => {
    expect(validateProofObject(proof({ signer: "alice" }))).toContain(
      "signer must be a 20-byte hex address",
    );
  });

  it("rejects a non-ISO attestation date", () => {
    expect(validateProofObject(proof({ date: "October 20, 2024" }))).toContain(
      "date must be an ISO 8601 instant",
    );
  });

  it("rejects a fingerprint that is not a content CID", () => {
    expect(validateProofObject(proof({ cid: "0x8f7da2b3" }))).toContain(
      "cid must be a CIDv1/raw/sha2-256 fingerprint",
    );
  });
});

describe("isAnchored", () => {
  it("is true only when both the transaction and the chain are known", () => {
    expect(isAnchored(proof())).toBe(true);
    expect(isAnchored(proof({ anchorTx: undefined }))).toBe(false);
    expect(isAnchored(proof({ anchorChainId: undefined }))).toBe(false);
  });
});

describe("verifyCid", () => {
  it("reports a registered fingerprint with the details the Verify screen shows", () => {
    const result = verifyCid(TRACK_3_CID, REGISTRY);
    expect(result.status).toBe("verified");
    expect(result.registration).toMatchObject({
      cid: TRACK_3_CID,
      registeredAt: "2024-10-20T11:23:00.000Z",
      creator: SIGNER,
      projectName: "Summer Album 2024",
      projectCategory: "Music",
      milestoneTitle: "Track 3 First Draft",
      milestoneStage: "draft",
      anchored: true,
    });
  });

  it("reports content that was never registered, without claiming it is invalid", () => {
    const result = verifyCid(OTHER_CID, REGISTRY);
    expect(result.status).toBe("unregistered");
    expect(result.registration).toBeUndefined();
  });

  it("distinguishes malformed input from an unregistered fingerprint", () => {
    expect(verifyCid("0xnot-a-cid", REGISTRY).status).toBe("invalid-input");
  });

  it("returns the earliest claim when the same fingerprint was registered twice", () => {
    const laterClaim: RegistryEntry = {
      project: { ...PROJECT, id: "p2", name: "Copycat EP", owner: "0x" + "9".repeat(40) },
      milestone: { ...MILESTONE, id: "m9", projectId: "p2", recordedAt: "2025-03-01T00:00:00.000Z" },
      proof: proof({ signer: "0x" + "9".repeat(40), date: "2025-03-01T00:00:00.000Z" }),
    };
    const result = verifyCid(TRACK_3_CID, [laterClaim, ...REGISTRY]);
    expect(result.registration?.projectName).toBe("Summer Album 2024");
    expect(result.registration?.creator).toBe(SIGNER);
  });

  it("flags an unanchored registration so the UI cannot present it as chain-backed", () => {
    const unanchored: RegistryEntry = {
      ...REGISTRY[0],
      proof: proof({ anchorTx: undefined, anchorChainId: undefined }),
    };
    const result = verifyCid(TRACK_3_CID, [unanchored]);
    expect(result.status).toBe("verified");
    expect(result.registration?.anchored).toBe(false);
    expect(result.registration?.anchorTx).toBeUndefined();
  });

  it("finds nothing in an empty registry", () => {
    expect(verifyCid(TRACK_3_CID, []).status).toBe("unregistered");
  });
});

describe("verifyContent", () => {
  it("verifies from the raw bytes, so the file never has to be uploaded", async () => {
    expect((await verifyContent(TRACK_3, REGISTRY)).status).toBe("verified");
  });

  it("does not match once a single byte of the content changes", async () => {
    expect((await verifyContent(utf8("track-3-first-draft "), REGISTRY)).status).toBe(
      "unregistered",
    );
  });
});
