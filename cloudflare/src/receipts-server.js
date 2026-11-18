// Issuance and lookup for proofstream-web receipts.
// The private key is read from env.RECEIPT_SIGNING_KEY and is never logged or stored in D1.
import {
  FINGERPRINT_RE,
  RECEIPT_ID_RE,
  canonicalReceiptPayload,
  encodeBase64Url,
  verifyReceipt,
} from '../public/receipts.js';

export const MAX_BODY_BYTES = 2048;
const METADATA = JSON.stringify({ algorithm: 'Ed25519', payload_version: 1 });

function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });
}

function fail(error, status) {
  return json({ error, verified: false }, status);
}

function coded(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isJsonContentType(value) {
  if (!value) return false;
  const media = value.split(';', 1)[0].trim().toLowerCase();
  return media === 'application/json';
}

export async function readLimitedBody(request, maxBytes) {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    return { error: 'body_too_large' };
  }
  if (request.body == null) return { text: '' };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* already over the cap */ }
      return { error: 'body_too_large' };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { error: 'invalid_json' };
  }
}

function decodePkcs8(secret) {
  const cleaned = secret.replace(/\s+/g, '');
  if (cleaned.length < 40 || cleaned.length > 512 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(cleaned)) {
    throw coded('signing_key_invalid');
  }
  const padded = cleaned.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (cleaned.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteLength < 32 || bytes.byteLength > 128) throw coded('signing_key_invalid');
  return bytes;
}

export async function loadSigningMaterial(secret) {
  if (typeof secret !== 'string' || secret.trim() === '') throw coded('signing_key_unavailable');
  try {
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      decodePkcs8(secret),
      { name: 'Ed25519' },
      true,
      ['sign'],
    );
    const exported = await crypto.subtle.exportKey('jwk', privateKey);
    if (exported.kty !== 'OKP' || exported.crv !== 'Ed25519' || typeof exported.x !== 'string') {
      throw coded('signing_key_invalid');
    }
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      { kty: 'OKP', crv: 'Ed25519', x: exported.x },
      { name: 'Ed25519' },
      true,
      ['verify'],
    );
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
    let hex = '';
    for (const byte of digest.slice(0, 8)) hex += byte.toString(16).padStart(2, '0');
    const publicJwk = {
      kid: `ed25519:${hex}`,
      kty: 'OKP',
      crv: 'Ed25519',
      alg: 'EdDSA',
      use: 'sig',
      x: exported.x,
    };
    return { privateKey, publicJwk };
  } catch (error) {
    if (error.code === 'signing_key_unavailable' || error.code === 'signing_key_invalid') throw error;
    throw coded('signing_key_invalid');
  }
}

function storeReady(env) {
  return Boolean(env && env.PROOFS_DB && typeof env.PROOFS_DB.prepare === 'function');
}

async function issueReceipt(request, env) {
  if (!isJsonContentType(request.headers.get('content-type'))) return fail('unsupported_media_type', 415);
  const body = await readLimitedBody(request, MAX_BODY_BYTES);
  if (body.error === 'body_too_large') return fail('body_too_large', 413);
  if (body.error) return fail('invalid_json', 400);
  let text = body.text.replace(/^\uFEFF/, '');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('invalid_json', 400);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('invalid_request', 400);
  const keys = Object.keys(data);
  if (keys.length !== 1 || keys[0] !== 'fingerprint') return fail('invalid_request', 400);
  if (typeof data.fingerprint !== 'string' || !/^[0-9a-fA-F]{64}$/.test(data.fingerprint)) {
    return fail('invalid_fingerprint', 400);
  }
  const fingerprint = data.fingerprint.toLowerCase();
  if (!FINGERPRINT_RE.test(fingerprint)) return fail('invalid_fingerprint', 400);

  let material;
  try {
    material = await loadSigningMaterial(env && env.RECEIPT_SIGNING_KEY);
  } catch (error) {
    return fail(error.code === 'signing_key_unavailable' ? 'signing_key_unavailable' : 'signing_key_invalid', 503);
  }
  if (!storeReady(env)) return fail('receipt_store_unavailable', 503);

  const receiptId = crypto.randomUUID();
  const issuedAt = new Date().toISOString();
  const unsigned = {
    receipt_id: receiptId,
    fingerprint,
    issued_at: issuedAt,
    key_id: material.publicJwk.kid,
  };
  let signature;
  try {
    const signed = await crypto.subtle.sign(
      { name: 'Ed25519' },
      material.privateKey,
      new TextEncoder().encode(canonicalReceiptPayload(unsigned)),
    );
    signature = encodeBase64Url(new Uint8Array(signed));
  } catch {
    return fail('receipt_signing_failed', 500);
  }
  const receipt = { ...unsigned, signature, algorithm: 'Ed25519', payload_version: 1 };
  const verification = await verifyReceipt(receipt, material.publicJwk);
  if (!verification.ok) return fail('receipt_signing_failed', 500);

  try {
    const result = await env.PROOFS_DB.prepare(
      'INSERT INTO receipts (receipt_id, fingerprint, issued_at, signature, key_id, metadata) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(receipt.receipt_id, receipt.fingerprint, receipt.issued_at, receipt.signature, receipt.key_id, METADATA).run();
    if (result && result.meta && result.meta.changes === 0) return fail('receipt_store_unavailable', 503);
  } catch {
    return fail('receipt_store_unavailable', 503);
  }

  return json({
    receipt,
    verified: true,
    verification: { ok: true, reason: 'valid', algorithm: 'Ed25519', key_id: receipt.key_id, payload_version: 1 },
  }, 201);
}

function rowToReceipt(row) {
  return {
    receipt_id: row.receipt_id,
    fingerprint: row.fingerprint,
    issued_at: row.issued_at,
    signature: row.signature,
    key_id: row.key_id,
    algorithm: 'Ed25519',
    payload_version: 1,
  };
}

async function lookupReceipt(id, env) {
  if (!storeReady(env)) return fail('receipt_store_unavailable', 503);
  let row;
  try {
    row = await env.PROOFS_DB.prepare(
      'SELECT receipt_id, fingerprint, issued_at, signature, key_id, metadata FROM receipts WHERE receipt_id = ?',
    ).bind(id).first();
  } catch {
    return fail('receipt_store_unavailable', 503);
  }
  if (row == null) return fail('receipt_not_found', 404);

  const receipt = rowToReceipt(row);
  let material;
  try {
    material = await loadSigningMaterial(env && env.RECEIPT_SIGNING_KEY);
  } catch (error) {
    const code = error.code === 'signing_key_unavailable' ? 'signing_key_unavailable' : 'signing_key_invalid';
    return json({
      error: code,
      receipt,
      verified: false,
      verification: { ok: false, reason: code },
    }, 503);
  }

  const verification = await verifyReceipt(receipt, material.publicJwk);
  return json({
    receipt,
    verified: verification.ok === true,
    verification: {
      ok: verification.ok === true,
      reason: verification.reason,
      algorithm: 'Ed25519',
      key_id: material.publicJwk.kid,
      payload_version: 1,
    },
  }, 200);
}

async function publicKey(env) {
  try {
    const material = await loadSigningMaterial(env && env.RECEIPT_SIGNING_KEY);
    return json(material.publicJwk, 200);
  } catch (error) {
    const code = error.code === 'signing_key_unavailable' ? 'signing_key_unavailable' : 'signing_key_invalid';
    return fail(code, 503);
  }
}

function methodNotAllowed(allow) {
  return json({ error: 'method_not_allowed', verified: false }, 405, { allow });
}

export async function handleReceipts(request, url, env) {
  const { pathname } = url;
  if (pathname === '/.well-known/proofstream-receipt-key.json') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET, HEAD');
    return publicKey(env);
  }
  if (pathname === '/api/v1/receipts' || pathname === '/api/v1/fingerprints') {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    return issueReceipt(request, env);
  }
  if (pathname.startsWith('/api/v1/receipts/')) {
    const rest = pathname.slice('/api/v1/receipts/'.length);
    if (!rest || rest.includes('/')) return fail('receipt_not_found', 404);
    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET, HEAD');
    const id = rest.toLowerCase();
    if (!RECEIPT_ID_RE.test(id)) return fail('invalid_receipt_id', 400);
    return lookupReceipt(id, env);
  }
  return fail('receipt_not_found', 404);
}
