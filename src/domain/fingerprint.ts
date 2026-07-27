import { createHash } from "node:crypto";

/**
 * Content fingerprinting for ProofStream.
 *
 * A registration's identity is the CID of the bytes the creator uploaded. The CID
 * is computed client-side (the Verify screen promises "we will generate the hash
 * locally"), so the raw file never has to leave the creator's machine to be checked
 * against the registry.
 *
 * We emit CIDv1 / raw codec / sha2-256 / base32-lower — the `bafkrei...` form the
 * notary pipeline records in its proof objects.
 */

const BASE32_LOWER_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** CIDv1 prefix bytes: version 1, raw codec (0x55), sha2-256 multihash (0x12), 32-byte digest (0x20). */
const CID_V1_RAW_SHA256_PREFIX = Uint8Array.from([0x01, 0x55, 0x12, 0x20]);

/** RFC 4648 base32, lowercase, unpadded — the multibase `b` encoding. */
export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bitsInBuffer = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsInBuffer += 8;
    while (bitsInBuffer >= 5) {
      bitsInBuffer -= 5;
      out += BASE32_LOWER_ALPHABET[(buffer >>> bitsInBuffer) & 0x1f];
    }
  }

  if (bitsInBuffer > 0) {
    out += BASE32_LOWER_ALPHABET[(buffer << (5 - bitsInBuffer)) & 0x1f];
  }

  return out;
}

export function base32Decode(text: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bitsInBuffer = 0;

  for (const char of text) {
    const value = BASE32_LOWER_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error(`invalid base32 character: ${char}`);
    }
    buffer = (buffer << 5) | value;
    bitsInBuffer += 5;
    if (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      out.push((buffer >>> bitsInBuffer) & 0xff);
    }
  }

  return Uint8Array.from(out);
}

/** Lowercase `0x`-prefixed sha2-256 of the content, for display next to the CID. */
export function sha256Hex(content: Uint8Array): string {
  return `0x${createHash("sha256").update(content).digest("hex")}`;
}

/** The canonical ProofStream fingerprint for a piece of content. */
export function contentCid(content: Uint8Array): string {
  const digest = createHash("sha256").update(content).digest();
  const cidBytes = new Uint8Array(CID_V1_RAW_SHA256_PREFIX.length + digest.length);
  cidBytes.set(CID_V1_RAW_SHA256_PREFIX, 0);
  cidBytes.set(digest, CID_V1_RAW_SHA256_PREFIX.length);
  return `b${base32Encode(cidBytes)}`;
}

/**
 * Structural check only — that a string is a CIDv1/raw/sha2-256 identifier. It says
 * nothing about whether the CID was ever registered; that is the registry's job.
 */
export function isContentCid(value: string): boolean {
  if (!value.startsWith("b")) return false;
  let bytes: Uint8Array;
  try {
    bytes = base32Decode(value.slice(1));
  } catch {
    return false;
  }
  if (bytes.length !== CID_V1_RAW_SHA256_PREFIX.length + 32) return false;
  return CID_V1_RAW_SHA256_PREFIX.every((byte, index) => bytes[index] === byte);
}

/** Recover the raw sha2-256 digest a CID commits to, so a verifier can re-hash and compare. */
export function digestFromCid(cid: string): Uint8Array {
  if (!isContentCid(cid)) {
    throw new Error(`not a CIDv1/raw/sha2-256 identifier: ${cid}`);
  }
  return base32Decode(cid.slice(1)).slice(CID_V1_RAW_SHA256_PREFIX.length);
}
