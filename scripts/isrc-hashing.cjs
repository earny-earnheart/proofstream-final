// Reference hashing for ProofStream ISRC records (see docs/isrc/SPEC.md §4).
// The API, the batcher, and the public verifier must all use this exact logic,
// or hashes will not match what ProofStreamISRCRegistry stores on-chain.
const crypto = require("crypto");
const { keccak256, toUtf8Bytes } = require("ethers");

const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{2}[0-9]{5}$/;

/**
 * RFC 8785 JSON Canonicalization Scheme for JSON-safe values.
 * Keys sorted by UTF-16 code units (JS default sort); numbers and strings use
 * ECMAScript JSON serialization, which RFC 8785 adopts. No dependency, so it
 * runs on every Node version in CI.
 */
function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JCS: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  throw new Error(`JCS: unsupported type ${typeof value}`);
}

/** "us-skg-26-12345" -> "USSKG2612345". Throws on invalid shape. */
function normalizeIsrc(raw) {
  const s = String(raw).toUpperCase().replace(/[-\s]/g, "");
  if (!ISRC_RE.test(s)) throw new Error(`Invalid ISRC: ${raw}`);
  return s;
}

/** Display form: "US-SKG-26-12345". */
function displayIsrc(normalized) {
  return `${normalized.slice(0, 2)}-${normalized.slice(2, 5)}-${normalized.slice(5, 7)}-${normalized.slice(7)}`;
}

/** UPC-A (12) or EAN-13 -> 13-digit GTIN, with check-digit validation. */
function normalizeUpc(raw) {
  const d = String(raw).replace(/\D/g, "");
  if (d.length !== 12 && d.length !== 13) throw new Error(`Invalid UPC/EAN length: ${raw}`);
  const g = d.padStart(13, "0");
  const sum = [...g.slice(0, 12)].reduce((acc, c, i) => acc + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  if ((10 - (sum % 10)) % 10 !== Number(g[12])) throw new Error(`Bad UPC/EAN check digit: ${raw}`);
  return g;
}

const isrcKey = (raw) => keccak256(toUtf8Bytes(normalizeIsrc(raw)));
const upcKey = (raw) => keccak256(toUtf8Bytes(normalizeUpc(raw)));

/** sha256 over RFC 8785 canonical JSON, returned as 0x-prefixed bytes32. */
function payloadHash(obj) {
  return "0x" + crypto.createHash("sha256").update(canonicalize(obj), "utf8").digest("hex");
}

module.exports = { canonicalize, normalizeIsrc, displayIsrc, normalizeUpc, isrcKey, upcKey, payloadHash };
