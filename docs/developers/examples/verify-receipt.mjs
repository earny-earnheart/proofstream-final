#!/usr/bin/env node
// Offline check for a ProofStream signed receipt.
// Node.js 18.4 or newer (WebCrypto Ed25519). No dependencies.
// Usage: node verify-receipt.mjs <receipt-id> [base-url]
// Default base URL: https://proofstreamapp.com
//
// The checks match cloudflare/public/receipts.js: canonical payload v1,
// base64url signature decoding, kid equality, then Ed25519 verify.

import { webcrypto } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const DEFAULT_BASE_URL = 'https://proofstreamapp.com';
export const PAYLOAD_HEADER = 'proofstream-receipt/v1';
export const RECEIPT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
export const KEY_ID_RE = /^ed25519:[0-9a-f]{16}$/;
export const SIGNATURE_RE = /^[A-Za-z0-9_-]{86}$/;

function subtleCrypto() {
  const cryptoApi = globalThis.crypto ?? webcrypto;
  if (!cryptoApi || !cryptoApi.subtle) {
    throw new Error('WebCrypto SubtleCrypto is not available');
  }
  return cryptoApi.subtle;
}

export function canonicalReceiptPayload(receipt) {
  return [
    PAYLOAD_HEADER,
    `receipt_id:${receipt.receipt_id}`,
    `fingerprint:${receipt.fingerprint}`,
    `issued_at:${receipt.issued_at}`,
    `kid:${receipt.key_id}`,
  ].join('\n');
}

export function isCanonicalTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && new Date(value).toISOString() === value;
}

export function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('bad-base64url');
  }
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function verifyReceipt(receipt, publicJwk) {
  if (!receipt || typeof receipt !== 'object') return { ok: false, reason: 'malformed_receipt' };
  if (!publicJwk || publicJwk.kty !== 'OKP' || publicJwk.crv !== 'Ed25519' || typeof publicJwk.x !== 'string' || typeof publicJwk.kid !== 'string') {
    return { ok: false, reason: 'malformed_key' };
  }
  if (receipt.key_id !== publicJwk.kid) return { ok: false, reason: 'key_mismatch' };
  if (!RECEIPT_ID_RE.test(receipt.receipt_id) || !FINGERPRINT_RE.test(receipt.fingerprint) || !KEY_ID_RE.test(receipt.key_id) || !isCanonicalTimestamp(receipt.issued_at) || !SIGNATURE_RE.test(receipt.signature)) {
    return { ok: false, reason: 'malformed_receipt' };
  }
  let signature;
  try {
    signature = decodeBase64Url(receipt.signature);
  } catch {
    return { ok: false, reason: 'malformed_receipt' };
  }
  if (signature.byteLength !== 64) return { ok: false, reason: 'malformed_receipt' };
  let key;
  try {
    key = await subtleCrypto().importKey(
      'jwk',
      { kty: 'OKP', crv: 'Ed25519', x: publicJwk.x },
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
  } catch {
    return { ok: false, reason: 'malformed_key' };
  }
  const payload = new TextEncoder().encode(canonicalReceiptPayload(receipt));
  const ok = await subtleCrypto().verify({ name: 'Ed25519' }, key, signature, payload);
  return ok ? { ok: true, reason: 'valid' } : { ok: false, reason: 'signature_mismatch' };
}

async function readJson(response) {
  const text = await response.text();
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

export async function verifyReceiptFromNetwork(receiptId, baseUrl = DEFAULT_BASE_URL) {
  const id = String(receiptId ?? '').trim().toLowerCase();
  if (!RECEIPT_ID_RE.test(id)) return { ok: false, message: 'invalid receipt id' };
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return { ok: false, message: 'invalid base URL' };
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    return { ok: false, message: 'base URL must be http or https' };
  }
  const receiptUrl = new URL(`/api/v1/receipts/${id}`, base);
  const keyUrl = new URL('/.well-known/proofstream-receipt-key.json', base);
  let receiptResponse;
  let keyResponse;
  try {
    [receiptResponse, keyResponse] = await Promise.all([
      fetch(receiptUrl, { headers: { accept: 'application/json' } }),
      fetch(keyUrl, { headers: { accept: 'application/json' } }),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `request failed: ${detail}` };
  }
  const receiptBody = await readJson(receiptResponse);
  const keyBody = await readJson(keyResponse);
  if (!keyBody.ok) return { ok: false, message: `public key response was not JSON (${keyResponse.status})` };
  if (!keyResponse.ok || !keyBody.value || typeof keyBody.value !== 'object') {
    const code = keyBody.value && keyBody.value.error ? keyBody.value.error : String(keyResponse.status);
    return { ok: false, message: `public key lookup failed: ${code}` };
  }
  if (!receiptBody.ok) return { ok: false, message: `receipt response was not JSON (${receiptResponse.status})` };
  const receipt = receiptBody.value && receiptBody.value.receipt;
  if (!receipt) {
    const code = receiptBody.value && receiptBody.value.error ? receiptBody.value.error : String(receiptResponse.status);
    return { ok: false, message: `receipt lookup failed: ${code}` };
  }
  const verification = await verifyReceipt(receipt, keyBody.value);
  if (!verification.ok) return { ok: false, message: `verification failed: ${verification.reason}`, reason: verification.reason };
  return {
    ok: true,
    output: {
      ok: true,
      reason: verification.reason,
      receipt_id: receipt.receipt_id,
      fingerprint: receipt.fingerprint,
      issued_at: receipt.issued_at,
      key_id: receipt.key_id,
      server_verified: receiptBody.value.verified === true,
    },
  };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

function printUsage() {
  console.error('usage: node verify-receipt.mjs <receipt-id> [base-url]');
}

if (isDirectRun()) {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2) {
    printUsage();
    process.exitCode = 1;
  } else {
    const [receiptId, baseUrl] = args;
    verifyReceiptFromNetwork(receiptId, baseUrl || DEFAULT_BASE_URL).then((result) => {
      if (!result.ok) {
        console.error(result.message);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
