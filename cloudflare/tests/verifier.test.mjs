import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/verify-production.sh', import.meta.url));
const stub = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const get = key => args[args.indexOf(key) + 1];
const url = new URL(args.at(-1));
if (url.hostname.endsWith('.workers.dev') && process.env.MOCK_NETWORK_FAILURE === '1') process.exit(6);
let status = 200, type = 'text/html; charset=utf-8';
let body = '<title>ProofStream — Your work. Your timeline.</title>';
let extras = '';
if (url.hostname.startsWith('www.')) {
 status = 301; extras = 'location: https://proofstreamapp.com' + url.pathname + url.search + '\\r\\nx-robots-tag: noindex, nofollow\\r\\n';
} else if (url.hostname.endsWith('.workers.dev')) { status = 404; body = 'Not found'; }
else if (get('--request') === 'POST') { status = 405; extras = 'allow: GET, HEAD\\r\\n'; }
else if (url.pathname === '/robots.txt') { type = 'text/plain'; body = 'Sitemap: https://proofstreamapp.com/sitemap.xml'; }
else if (url.pathname === '/sitemap.xml') { type = 'application/xml'; body = '<loc>https://proofstreamapp.com/</loc>'; }
else if (url.pathname === '/.well-known/security.txt') { type = 'text/plain'; body = 'Contact: mailto:pantheonconsultinggroup@gmail.com'; }
else if (url.pathname === '/health') { type = 'application/json'; body = JSON.stringify({ status: 'ok', service: 'proofstream-web', time: new Date().toISOString() }); extras = 'cache-control: no-store\\r\\n'; }
else if (url.pathname === '/definitely-not-a-page') { status = process.env.MOCK_SOFT_404 === '1' ? 200 : 404; body = '<meta name="robots" content="noindex">'; }
else if (url.pathname === '/example-path/') { status = 301; extras = 'location: https://proofstreamapp.com/example-path?x=1\\r\\n'; }
const headers = 'HTTP/2 ' + status + '\\r\\ncontent-type: ' + type + '\\r\\n' + extras +
 'strict-transport-security: max-age=31536000; includeSubDomains\\r\\ncontent-security-policy: default-src self\\r\\nx-frame-options: DENY\\r\\nx-content-type-options: nosniff\\r\\n\\r\\n';
fs.writeFileSync(get('--dump-header'), headers);
fs.writeFileSync(get('--output'), body);
process.stdout.write(String(status));
`;

async function run(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'proofstream-curl-test-'));
  try {
    const curl = join(directory, 'curl');
    await writeFile(curl, stub);
    await chmod(curl, 0o755);
    return spawnSync('bash', [script], {
      encoding: 'utf8',
      env: { ...process.env, ...overrides, PATH: directory + ':' + process.env.PATH },
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('production verifier accepts the complete expected HTTP behavior', async () => {
  const result = await run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /All production checks passed/);
});

test('production verifier rejects a workers.dev network failure instead of calling it disabled', async () => {
  const result = await run({ MOCK_NETWORK_FAILURE: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL: workers.dev disabled check \(HTTP NETWORK_ERROR/);
});

test('production verifier rejects a soft-404 app-shell response', async () => {
  const result = await run({ MOCK_SOFT_404: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL: Unknown path must be 404/);
});
