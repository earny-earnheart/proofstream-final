import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../src/worker.js';

const origin = 'https://proofstreamapp.com';
const request = (path = '/', method = 'GET', host = origin) => new Request(host + path, { method });
function envWith(response = () => new Response('ProofStream', {
  headers: { 'content-type': 'text/html; charset=utf-8', etag: '"sample-etag"', 'cache-control': 'public, max-age=30' },
})) {
  const calls = [];
  return { calls, ASSETS: { fetch: async req => { calls.push(req); return response(req); } } };
}
function secure(response) {
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
}

test('serves assets and preserves content type, etag, cache and body', async () => {
  const env = envWith();
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ProofStream');
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('etag'), '"sample-etag"');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=30');
  assert.equal(response.headers.get('x-robots-tag'), null);
  assert.equal(env.calls.length, 1);
  secure(response);
});

test('redirects www first, preserving encoded path and query, with noindex/security headers', async () => {
  const env = envWith();
  const response = await worker.fetch(request('/some/path?x=1&next=%2Fhello', 'POST', 'https://www.proofstreamapp.com'), env);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), 'https://proofstreamapp.com/some/path?x=1&next=%2Fhello');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(env.calls.length, 0);
  secure(response);
});

test('blocks unsupported methods before health and slash redirects', async () => {
  for (const path of ['/', '/health', '/project/']) {
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const env = envWith();
      const response = await worker.fetch(request(path, method), env);
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'GET, HEAD');
      assert.equal(env.calls.length, 0);
      secure(response);
    }
  }
});

test('health returns no-store JSON with a current ISO timestamp, and HEAD has no body', async () => {
  const env = envWith();
  const before = Date.now();
  const response = await worker.fetch(request('/health'), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'proofstream-web');
  assert.equal(new Date(body.time).toISOString(), body.time);
  assert(Date.parse(body.time) >= before && Date.parse(body.time) <= Date.now());
  secure(response);
  const head = await worker.fetch(request('/health', 'HEAD'), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(env.calls.length, 0);
  secure(head);
});

test('strips non-root trailing slashes while preserving query and leaves root alone', async () => {
  const env = envWith();
  const response = await worker.fetch(request('/projects///?x=1'), env);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), origin + '/projects?x=1');
  secure(response);
  assert.equal((await worker.fetch(request('/?x=1'), env)).status, 200);
  assert.equal(env.calls.length, 1);
});

test('preserves asset 404 and 304 statuses and HEAD response metadata', async () => {
  const missing = await worker.fetch(request('/definitely-not-a-page'), envWith(() => new Response('<title>Not found</title>', { status: 404, headers: { 'content-type': 'text/html' } })));
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Not found/);
  secure(missing);
  const head = await worker.fetch(request('/styles.css', 'HEAD'), envWith());
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('etag'), '"sample-etag"');
  secure(head);
  const unchanged = await worker.fetch(request('/'), envWith(() => new Response(null, { status: 304, headers: { etag: '"same"' } })));
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.headers.get('etag'), '"same"');
  secure(unchanged);
});

test('non-canonical hosts are noindexed and asset failures receive secure 502 responses', async () => {
  const alternate = await worker.fetch(request('/', 'GET', 'https://example.invalid'), envWith());
  assert.equal(alternate.headers.get('x-robots-tag'), 'noindex, nofollow');
  secure(alternate);
  const error = await worker.fetch(request(), envWith(() => { throw new Error('internal failure'); }));
  assert.equal(error.status, 502);
  assert.equal(error.headers.get('cache-control'), 'no-store');
  assert(!(await error.text()).includes('internal failure'));
  secure(error);
});

test('CSP permits no remote origins, eval or inline scripts', async () => {
  const response = await worker.fetch(request(), envWith());
  const CONTENT_SECURITY_POLICY = response.headers.get('content-security-policy');
  assert(CONTENT_SECURITY_POLICY.includes("script-src 'self'"));
  assert(CONTENT_SECURITY_POLICY.includes("style-src 'self'"));
  assert(CONTENT_SECURITY_POLICY.includes("style-src-attr 'none'"));
  assert(!CONTENT_SECURITY_POLICY.includes('unsafe-eval'));
  assert(!CONTENT_SECURITY_POLICY.includes('unsafe-inline'));
  assert(!CONTENT_SECURITY_POLICY.includes('https:'));
});

test('deployment configuration preserves the existing worker, account and only two custom domains', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.name, 'proofstream-web');
  assert.equal(config.account_id, '7914583bf80f67154ca9364681c0af85');
  assert.match(config.account_id, /^[a-f\d]{32}$/);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.assets.binding, 'ASSETS');
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.assets.not_found_handling, '404-page');
  assert.deepEqual(config.routes, [
    { pattern: 'proofstreamapp.com', custom_domain: true },
    { pattern: 'www.proofstreamapp.com', custom_domain: true },
  ]);
});
