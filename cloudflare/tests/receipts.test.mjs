import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';
import { canonicalReceiptPayload, decodeBase64Url, verifyReceipt } from '../public/receipts.js';

const origin = 'https://proofstreamapp.com';
const fingerprint = 'ab'.repeat(32);

function throwawaySigningSecret() {
  const { privateKey } = generateKeyPairSync('ed25519');
  return Buffer.from(privateKey.export({ type: 'pkcs8', format: 'der' })).toString('base64');
}

class Stmt {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Stmt(this.db, this.sql, args);
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.args) ?? null;
  }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

function makeProofsDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../migrations/0001_receipts.sql', import.meta.url), 'utf8'));
  return {
    raw,
    prepare(sql) {
      return new Stmt(raw, sql);
    },
  };
}

function envFor(secret, db = makeProofsDb(), assets = async () => new Response('receipt page', { headers: { 'content-type': 'text/html; charset=utf-8' } })) {
  const calls = [];
  return {
    calls,
    RECEIPT_SIGNING_KEY: secret,
    PROOFS_DB: db,
    ASSETS: {
      fetch: async (request) => {
        calls.push(request);
        return assets(request);
      },
    },
  };
}

function postReceipt(env, body, path = '/api/v1/receipts', headers = { 'content-type': 'application/json' }) {
  return worker.fetch(new Request(origin + path, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), env);
}

test('issues a signed receipt, stores it, and looks it up', async () => {
  const secret = throwawaySigningSecret();
  const db = makeProofsDb();
  const env = envFor(secret, db);
  const created = await postReceipt(env, { fingerprint: fingerprint.toUpperCase() });
  assert.equal(created.status, 201);
  assert.match(created.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  const issued = await created.json();
  assert.equal(issued.verified, true);
  assert.equal(issued.verification.reason, 'valid');
  assert.equal(issued.receipt.fingerprint, fingerprint);
  assert.equal(issued.receipt.algorithm, 'Ed25519');
  assert.equal(issued.receipt.payload_version, 1);
  assert.match(issued.receipt.receipt_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(issued.receipt.key_id, /^ed25519:[0-9a-f]{16}$/);
  assert.equal(JSON.stringify(issued).includes(secret), false);
  assert.equal(Object.hasOwn(issued.receipt, 'd'), false);

  const row = db.raw.prepare('SELECT receipt_id, fingerprint, issued_at, signature, key_id, metadata FROM receipts').get();
  assert.equal(row.receipt_id, issued.receipt.receipt_id);
  assert.equal(row.fingerprint, fingerprint);
  assert.equal(row.signature, issued.receipt.signature);
  assert.equal(row.key_id, issued.receipt.key_id);
  assert.deepEqual(JSON.parse(row.metadata), { algorithm: 'Ed25519', payload_version: 1 });

  const keyResponse = await worker.fetch(new Request(origin + '/.well-known/proofstream-receipt-key.json'), env);
  const publicJwk = await keyResponse.json();
  assert.equal(keyResponse.status, 200);
  assert.deepEqual(Object.keys(publicJwk).sort(), ['alg', 'crv', 'kid', 'kty', 'use', 'x']);
  assert.equal(publicJwk.kid, issued.receipt.key_id);
  assert.equal(publicJwk.kty, 'OKP');
  assert.equal(publicJwk.crv, 'Ed25519');
  assert.equal(Object.hasOwn(publicJwk, 'd'), false);

  const expected = [
    'proofstream-receipt/v1',
    `receipt_id:${issued.receipt.receipt_id}`,
    `fingerprint:${fingerprint}`,
    `issued_at:${issued.receipt.issued_at}`,
    `kid:${publicJwk.kid}`,
  ].join('\n');
  assert.equal(canonicalReceiptPayload(issued.receipt), expected);
  assert.equal(expected.endsWith('\n'), false);
  const key = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: publicJwk.x }, { name: 'Ed25519' }, false, ['verify']);
  const signature = decodeBase64Url(issued.receipt.signature);
  assert.equal(signature.byteLength, 64);
  assert.equal(await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, new TextEncoder().encode(expected)), true);
  assert.deepEqual(await verifyReceipt(issued.receipt, publicJwk), { ok: true, reason: 'valid' });

  const lookedUp = await worker.fetch(new Request(`${origin}/api/v1/receipts/${issued.receipt.receipt_id.toUpperCase()}`), env);
  const body = await lookedUp.json();
  assert.equal(lookedUp.status, 200);
  assert.equal(body.verified, true);
  assert.equal(body.receipt.signature, issued.receipt.signature);
  const head = await worker.fetch(new Request(`${origin}/api/v1/receipts/${issued.receipt.receipt_id}`, { method: 'HEAD' }), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('POST /api/v1/fingerprints issues the same kind of receipt', async () => {
  const env = envFor(throwawaySigningSecret());
  const created = await postReceipt(env, { fingerprint }, '/api/v1/fingerprints', { 'content-type': 'application/json; charset=utf-8' });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.receipt.fingerprint, fingerprint);
  assert.equal(body.verified, true);
});

test('the same fingerprint can be receipted more than once', async () => {
  const env = envFor(throwawaySigningSecret());
  const first = await (await postReceipt(env, { fingerprint })).json();
  const second = await (await postReceipt(env, { fingerprint })).json();
  assert.notEqual(first.receipt.receipt_id, second.receipt.receipt_id);
  assert.equal(env.PROOFS_DB.raw.prepare('SELECT COUNT(*) AS n FROM receipts').get().n, 2);
});

test('a missing or blank signing secret fails closed and stores nothing', async () => {
  for (const secret of [undefined, '', '   \n']) {
    const db = makeProofsDb();
    const env = envFor(secret, db);
    delete env.RECEIPT_SIGNING_KEY;
    if (secret !== undefined) env.RECEIPT_SIGNING_KEY = secret;
    const response = await postReceipt(env, { fingerprint });
    const text = await response.text();
    assert.equal(response.status, 503, text);
    const body = JSON.parse(text);
    assert.equal(body.error, 'signing_key_unavailable');
    assert.equal(body.verified, false);
    assert.equal(Object.hasOwn(body, 'receipt'), false);
    assert.equal(Object.hasOwn(body, 'signature'), false);
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM receipts').get().n, 0);
  }
});

test('an unusable signing secret fails closed and stores nothing', async () => {
  const db = makeProofsDb();
  const response = await postReceipt(envFor('AAAA', db), { fingerprint });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error, 'signing_key_invalid');
  assert.equal(Object.hasOwn(body, 'receipt'), false);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM receipts').get().n, 0);
});

test('a newline inside an otherwise valid secret still signs', async () => {
  const secret = throwawaySigningSecret();
  const wrapped = secret.slice(0, 20) + '\n' + secret.slice(20);
  const response = await postReceipt(envFor(wrapped), { fingerprint });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).verified, true);
});

test('missing D1 or a failing insert does not return a receipt', async () => {
  const secret = throwawaySigningSecret();
  const missing = await postReceipt({ RECEIPT_SIGNING_KEY: secret }, { fingerprint });
  const missingBody = await missing.json();
  assert.equal(missing.status, 503);
  assert.equal(missingBody.error, 'receipt_store_unavailable');
  assert.equal(Object.hasOwn(missingBody, 'receipt'), false);

  const throwing = {
    prepare() {
      return { bind() { return this; }, async run() { throw new Error('disk full'); } };
    },
  };
  const failed = await postReceipt(envFor(secret, throwing), { fingerprint });
  const text = await failed.text();
  assert.equal(failed.status, 503);
  assert.equal(JSON.parse(text).error, 'receipt_store_unavailable');
  assert.equal(text.includes('disk full'), false);
  assert.equal(text.includes(secret), false);
});

test('rejects oversized, mistyped, and malformed issuance input', async () => {
  const env = envFor(throwawaySigningSecret());
  const cases = [
    [{ fingerprint, note: 'extra' }, 400, 'invalid_request'],
    [{}, 400, 'invalid_request'],
    [[fingerprint], 400, 'invalid_request'],
    [{ fingerprint: '0x' + fingerprint }, 400, 'invalid_fingerprint'],
    [{ fingerprint: 'zz'.repeat(32) }, 400, 'invalid_fingerprint'],
    [{ fingerprint: fingerprint.slice(0, 63) }, 400, 'invalid_fingerprint'],
    ['{', 400, 'invalid_json'],
  ];
  for (const [body, status, error] of cases) {
    const response = await postReceipt(env, body);
    const parsed = await response.json();
    assert.equal(response.status, status, JSON.stringify(parsed));
    assert.equal(parsed.error, error);
    assert.equal(Object.hasOwn(parsed, 'receipt'), false);
  }
  assert.equal(env.PROOFS_DB.raw.prepare('SELECT COUNT(*) AS n FROM receipts').get().n, 0);

  const plain = await postReceipt(env, { fingerprint }, '/api/v1/receipts', { 'content-type': 'text/plain' });
  assert.equal(plain.status, 415);
  assert.equal((await plain.json()).error, 'unsupported_media_type');

  const oversized = await postReceipt(env, { fingerprint, pad: 'x'.repeat(MAX_PAD) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, 'body_too_large');

  const declared = await worker.fetch(new Request(origin + '/api/v1/receipts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '99999' },
    body: JSON.stringify({ fingerprint }),
  }), env);
  assert.equal(declared.status, 413);
  assert.equal(env.PROOFS_DB.raw.prepare('SELECT COUNT(*) AS n FROM receipts').get().n, 0);
});

const MAX_PAD = 2100;

test('lookup rejects a tampered signature or fingerprint and an unknown id', async () => {
  const db = makeProofsDb();
  const env = envFor(throwawaySigningSecret(), db);
  const issued = await (await postReceipt(env, { fingerprint })).json();
  const id = issued.receipt.receipt_id;

  db.raw.prepare('UPDATE receipts SET signature = ? WHERE receipt_id = ?').run('A'.repeat(86), id);
  const tampered = await worker.fetch(new Request(`${origin}/api/v1/receipts/${id}`), env);
  const tamperedBody = await tampered.json();
  assert.equal(tampered.status, 200);
  assert.equal(tamperedBody.verified, false);
  assert.equal(tamperedBody.verification.ok, false);
  assert.equal(tamperedBody.verification.reason, 'signature_mismatch');
  assert.equal(tamperedBody.receipt.signature, 'A'.repeat(86));

  const flipped = fingerprint.replace('a', 'b');
  db.raw.prepare('UPDATE receipts SET fingerprint = ?, signature = ? WHERE receipt_id = ?').run(flipped, issued.receipt.signature, id);
  const changed = await (await worker.fetch(new Request(`${origin}/api/v1/receipts/${id}`), env)).json();
  assert.equal(changed.verified, false);
  assert.equal(changed.verification.reason, 'signature_mismatch');

  db.raw.prepare('UPDATE receipts SET key_id = ? WHERE receipt_id = ?').run('ed25519:0000000000000000', id);
  const otherKey = await (await worker.fetch(new Request(`${origin}/api/v1/receipts/${id}`), env)).json();
  assert.equal(otherKey.verified, false);
  assert.equal(otherKey.verification.reason, 'key_mismatch');

  const missing = await worker.fetch(new Request(`${origin}/api/v1/receipts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`), env);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'receipt_not_found');

  const injected = await worker.fetch(new Request(`${origin}/api/v1/receipts/${id}'%20OR%201%3D1`), env);
  assert.equal(injected.status, 400);
  assert.equal((await injected.json()).error, 'invalid_receipt_id');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM receipts').get().n, 1);
});

test('lookup does not report a stored receipt as verified when the secret is later removed', async () => {
  const db = makeProofsDb();
  const env = envFor(throwawaySigningSecret(), db);
  const issued = await (await postReceipt(env, { fingerprint })).json();
  delete env.RECEIPT_SIGNING_KEY;
  const response = await worker.fetch(new Request(`${origin}/api/v1/receipts/${issued.receipt.receipt_id}`), env);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.verified, false);
  assert.equal(body.verification.reason, 'signing_key_unavailable');
  assert.equal(body.receipt.receipt_id, issued.receipt.receipt_id);
});

test('receipt routes reject the wrong method and leave the rest of the site alone', async () => {
  const env = envFor(throwawaySigningSecret());
  const getCollection = await worker.fetch(new Request(origin + '/api/v1/receipts'), env);
  assert.equal(getCollection.status, 405);
  assert.equal(getCollection.headers.get('allow'), 'POST');
  const postHome = await worker.fetch(new Request(origin + '/', { method: 'POST' }), env);
  assert.equal(postHome.status, 405);
  assert.equal(postHome.headers.get('allow'), 'GET, HEAD');
  const health = await worker.fetch(new Request(origin + '/health'), env);
  assert.equal((await health.json()).status, 'ok');
  const www = await worker.fetch(new Request('https://www.proofstreamapp.com/api/v1/receipts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fingerprint }),
  }), env);
  assert.equal(www.status, 301);
  assert.equal(env.PROOFS_DB.raw.prepare('SELECT COUNT(*) AS n FROM receipts').get().n, 0);
});

test('the public receipt page is served from the static document with security headers', async () => {
  const env = envFor(throwawaySigningSecret());
  const response = await worker.fetch(new Request(origin + '/receipts?id=abc'), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'receipt page');
  assert.equal(new URL(env.calls[0].url).pathname, '/receipts.html');
  assert.equal(new URL(env.calls[0].url).search, '?id=abc');
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(response.headers.get('content-security-policy').includes('unsafe-inline'), false);
});

test('the receipt page and script stay on the strict same-origin CSP', async () => {
  const html = await readFile(new URL('../public/receipts.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/receipts.js', import.meta.url), 'utf8');
  assert.match(html, /src="\/receipts\.js"/);
  assert.match(html, /type="module"/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  assert.doesNotMatch(html, /\sstyle="/i);
  assert.match(html, /proofstream-receipt\/v1/);
  assert.match(html, /RECEIPT_SIGNING_KEY/);
  for (const url of [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((match) => match[1])) {
    assert.match(url, /^(?:#|\/|https:\/\/proofstreamapp\.com\/)/);
  }
  assert.doesNotMatch(script, /innerHTML|document\.write|eval\(|RECEIPT_SIGNING_KEY|BEGIN PRIVATE/);
});

test('the workspace asks for a receipt only after the local milestone is saved', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const saveAt = app.indexOf('try{save();}catch(error){project.milestones.shift()');
  const issueAt = app.indexOf('await issueSignedReceipt(hash)');
  assert.notEqual(saveAt, -1);
  assert.ok(issueAt > saveAt);
  assert.match(app, /fetch\('\/api\/v1\/fingerprints'/);
  assert.match(app, /the file itself is never uploaded/);
});

test('wrangler config binds the placeholder proofs database and the migration names the columns', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.name, 'proofstream-web');
  assert.deepEqual(config.d1_databases, [{
    binding: 'PROOFS_DB',
    database_name: 'proofstream-proofs',
    database_id: '00000000-0000-0000-0000-000000000000',
    migrations_dir: 'migrations',
  }]);
  const sql = await readFile(new URL('../migrations/0001_receipts.sql', import.meta.url), 'utf8');
  for (const column of ['receipt_id', 'fingerprint', 'issued_at', 'signature', 'key_id', 'metadata']) {
    assert.match(sql, new RegExp(`\\b${column}\\b`));
  }
  assert.match(sql, /00000000-0000-0000-0000-000000000000/);
  const columns = makeProofsDb().raw.prepare('PRAGMA table_info(receipts)').all().map((column) => column.name);
  assert.deepEqual(columns, ['receipt_id', 'fingerprint', 'issued_at', 'signature', 'key_id', 'metadata']);
});
