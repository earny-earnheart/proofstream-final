import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalReceiptPayload as appPayload,
  verifyReceipt as appVerify,
} from '../../../cloudflare/public/receipts.js';
import {
  PAYLOAD_HEADER,
  canonicalReceiptPayload,
  decodeBase64Url,
  encodeBase64Url,
  verifyReceipt,
} from './verify-receipt.mjs';

const issuedAt = '2026-11-24T18:38:00.123Z';
const fingerprint = 'ab'.repeat(32);
const receiptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function throwawayReceipt() {
  const subtle = globalThis.crypto.subtle;
  const pair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const exported = await subtle.exportKey('jwk', pair.publicKey);
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const digest = new Uint8Array(await subtle.digest('SHA-256', raw));
  let hex = '';
  for (const byte of digest.slice(0, 8)) hex += byte.toString(16).padStart(2, '0');
  const kid = `ed25519:${hex}`;
  const publicJwk = {
    kid,
    kty: 'OKP',
    crv: 'Ed25519',
    alg: 'EdDSA',
    use: 'sig',
    x: exported.x,
  };
  const receipt = {
    receipt_id: receiptId,
    fingerprint,
    issued_at: issuedAt,
    key_id: kid,
  };
  const payload = canonicalReceiptPayload(receipt);
  const signature = new Uint8Array(await subtle.sign(
    { name: 'Ed25519' },
    pair.privateKey,
    new TextEncoder().encode(payload),
  ));
  receipt.signature = encodeBase64Url(signature);
  return { receipt, publicJwk, payload };
}

test('canonical v1 payload is five LF-separated lines and has no trailing newline', () => {
  const receipt = {
    receipt_id: receiptId,
    fingerprint,
    issued_at: issuedAt,
    key_id: 'ed25519:0123456789abcdef',
  };
  const payload = canonicalReceiptPayload(receipt);
  assert.equal(payload, [
    PAYLOAD_HEADER,
    `receipt_id:${receiptId}`,
    `fingerprint:${fingerprint}`,
    `issued_at:${issuedAt}`,
    'kid:ed25519:0123456789abcdef',
  ].join('\n'));
  assert.equal(payload.endsWith('\n'), false);
  assert.equal(payload.split('\n').length, 5);
  assert.equal(appPayload(receipt), payload);
});

test('a throwaway Ed25519 key verifies, and the app verifier agrees', async () => {
  const { receipt, publicJwk } = await throwawayReceipt();
  const signature = decodeBase64Url(receipt.signature);
  assert.equal(signature.byteLength, 64);
  assert.equal(receipt.signature.includes('='), false);
  assert.deepEqual(await verifyReceipt(receipt, publicJwk), { ok: true, reason: 'valid' });
  assert.deepEqual(await appVerify(receipt, publicJwk), { ok: true, reason: 'valid' });
});

test('a changed fingerprint or a replaced signature is signature_mismatch', async () => {
  const { receipt, publicJwk } = await throwawayReceipt();
  const flipped = { ...receipt, fingerprint: fingerprint.replace('a', 'b') };
  assert.equal(canonicalReceiptPayload(flipped).endsWith('\n'), false);
  assert.deepEqual(await verifyReceipt(flipped, publicJwk), { ok: false, reason: 'signature_mismatch' });
  assert.deepEqual(await appVerify(flipped, publicJwk), { ok: false, reason: 'signature_mismatch' });

  const replaced = { ...receipt, signature: 'A'.repeat(86) };
  assert.deepEqual(await verifyReceipt(replaced, publicJwk), { ok: false, reason: 'signature_mismatch' });
  assert.deepEqual(await appVerify(replaced, publicJwk), { ok: false, reason: 'signature_mismatch' });
});

test('kid inequality is key_mismatch before the signature is checked', async () => {
  const { receipt, publicJwk } = await throwawayReceipt();
  const other = { ...receipt, key_id: 'ed25519:0000000000000000' };
  assert.notEqual(other.key_id, publicJwk.kid);
  assert.deepEqual(await verifyReceipt(other, publicJwk), { ok: false, reason: 'key_mismatch' });
  assert.deepEqual(await appVerify(other, publicJwk), { ok: false, reason: 'key_mismatch' });
});

test('a timestamp that is not canonical is malformed_receipt', async () => {
  const { receipt, publicJwk } = await throwawayReceipt();
  const badTime = { ...receipt, issued_at: '2026-11-24T18:38:00Z' };
  assert.deepEqual(await verifyReceipt(badTime, publicJwk), { ok: false, reason: 'malformed_receipt' });
  assert.deepEqual(await appVerify(badTime, publicJwk), { ok: false, reason: 'malformed_receipt' });
});

test('base64url decode rejects padding and non-alphabet characters', () => {
  assert.throws(() => decodeBase64Url(`${'A'.repeat(86)}=`), /bad-base64url/);
  assert.throws(() => decodeBase64Url('A'.repeat(85) + '+'), /bad-base64url/);
  const bytes = decodeBase64Url(encodeBase64Url(new Uint8Array(64).fill(7)));
  assert.equal(bytes.byteLength, 64);
  assert.equal(bytes[0], 7);
});
