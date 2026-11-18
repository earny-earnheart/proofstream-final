// Shared receipt verifier for the public page and the proofstream-web Worker.
// Payload version 1 is Ed25519 over the UTF-8 lines below (LF, no trailing newline):
//   proofstream-receipt/v1
//   receipt_id:<uuid v4>
//   fingerprint:<64 lowercase hex>
//   issued_at:<YYYY-MM-DDTHH:mm:ss.sssZ>
//   kid:<key id>
// This file never holds a private key. Issuance lives in src/receipts-server.js.

export const PAYLOAD_HEADER = 'proofstream-receipt/v1';
export const RECEIPT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
export const KEY_ID_RE = /^ed25519:[0-9a-f]{16}$/;
export const SIGNATURE_RE = /^[A-Za-z0-9_-]{86}$/;

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
    key = await crypto.subtle.importKey(
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
  const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, payload);
  return ok ? { ok: true, reason: 'valid' } : { ok: false, reason: 'signature_mismatch' };
}

const REASON_TEXT = {
  valid: 'Signature matches the published public key.',
  signature_mismatch: 'The signature does not match the canonical payload.',
  key_mismatch: 'The receipt key id does not match the published key.',
  malformed_receipt: 'The receipt fields are not in the expected form.',
  malformed_key: 'The published key is not a usable Ed25519 public key.',
  signing_key_unavailable: 'The signing key is unavailable, so this receipt is not verified.',
};

function reasonText(reason) {
  return REASON_TEXT[reason] || 'The receipt did not verify.';
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function renderResult(receiptBody, local) {
  const result = document.getElementById('receipt-result');
  const status = document.getElementById('receipt-status');
  const disagree = document.getElementById('receipt-disagree');
  const receipt = receiptBody.receipt;
  const serverOk = receiptBody.verified === true;
  const browserOk = local.ok === true;
  const both = serverOk && browserOk;
  result.hidden = false;
  status.textContent = both ? 'Signature verifies' : 'Signature does not verify';
  status.classList.toggle('ok-text', both);
  status.classList.toggle('bad-text', !both);
  setText('field-id', receipt.receipt_id);
  setText('field-fingerprint', receipt.fingerprint);
  setText('field-issued', receipt.issued_at);
  setText('field-kid', receipt.key_id);
  setText('field-signature', receipt.signature);
  setText('field-payload', canonicalReceiptPayload(receipt));
  setText('field-browser', reasonText(local.reason));
  const serverReason = receiptBody.verification && receiptBody.verification.reason;
  setText('field-server', serverOk ? 'Server reports the signature as valid.' : `Server rejected the signature${serverReason ? ` (${serverReason})` : ''}.`);
  disagree.textContent = serverOk === browserOk ? '' : 'The browser check and the server check disagree. Treat the receipt as not verified.';
}

async function lookupReceipt(id) {
  const error = document.getElementById('receipt-error');
  const result = document.getElementById('receipt-result');
  error.textContent = '';
  result.hidden = true;
  const normalized = id.trim().toLowerCase();
  if (!RECEIPT_ID_RE.test(normalized)) {
    error.textContent = 'Enter the receipt id from the signed receipt (a UUID).';
    return;
  }
  let receiptResponse;
  let keyResponse;
  try {
    [receiptResponse, keyResponse] = await Promise.all([
      fetch(`/api/v1/receipts/${normalized}`, { headers: { accept: 'application/json' } }),
      fetch('/.well-known/proofstream-receipt-key.json', { headers: { accept: 'application/json' } }),
    ]);
  } catch {
    error.textContent = 'The receipt service could not be reached.';
    return;
  }
  if (receiptResponse.status === 404) {
    error.textContent = 'No receipt is stored for that id.';
    return;
  }
  let receiptBody = null;
  try {
    receiptBody = await receiptResponse.json();
  } catch {
    receiptBody = null;
  }
  if (!receiptBody || !receiptBody.receipt) {
    error.textContent = receiptBody && receiptBody.error === 'signing_key_unavailable'
      ? 'The signing key is unavailable, so this receipt cannot be verified.'
      : 'The receipt could not be read.';
    return;
  }
  let publicJwk = null;
  if (keyResponse.ok) {
    try {
      publicJwk = await keyResponse.json();
    } catch {
      publicJwk = null;
    }
  }
  const local = publicJwk
    ? await verifyReceipt(receiptBody.receipt, publicJwk)
    : { ok: false, reason: 'signing_key_unavailable' };
  renderResult(receiptBody, local);
}

function initReceiptPage() {
  const form = document.getElementById('receipt-lookup');
  const input = document.getElementById('receipt-id');
  if (!form || !input) return;
  const params = new URLSearchParams(window.location.search);
  const initial = params.get('id');
  if (initial) {
    input.value = initial;
    lookupReceipt(initial);
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const id = input.value;
    const next = new URL(window.location.href);
    next.search = '';
    next.searchParams.set('id', id.trim());
    window.history.replaceState(null, '', next);
    lookupReceipt(id);
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initReceiptPage);
  else initReceiptPage();
}
