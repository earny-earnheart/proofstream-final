// ProofStream's thin Cloudflare Workers Static Assets front controller.
// The only routes configured for production are the apex and www custom domains.
import { handleReceipts } from './receipts-server.js';
const CANONICAL_HOST = 'proofstreamapp.com';

// No third-party origins, inline scripts, eval, fonts or analytics are needed.
// The waveform uses static CSS classes, so inline style blocks and attributes
// can both remain disabled.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'none'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
].join('; ');

function secureResponse(response, request) {
  // Copy rather than replace asset headers: content-type, etag and caching survive.
  const headers = new Headers(response.headers);
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('content-security-policy', CONTENT_SECURITY_POLICY);
  if (new URL(request.url).hostname !== CANONICAL_HOST) {
    headers.set('x-robots-tag', 'noindex, nofollow');
  }
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response;

    // 1. Keep the path and search string when redirecting www to the canonical host.
    if (url.hostname === 'www.proofstreamapp.com') {
      url.hostname = CANONICAL_HOST;
      url.protocol = 'https:';
      url.port = '';
      response = new Response(null, { status: 301, headers: { location: url.href } });
    // 2. Signed-receipt API. Issuance is POST-only; every other path stays GET/HEAD.
    } else if (isReceiptPath(url.pathname)) {
      try {
        response = await handleReceipts(request, url, env);
      } catch {
        response = new Response(JSON.stringify({ error: 'receipt_unavailable', verified: false }), {
          status: 500,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
    // 3. Pages other than the receipt API do not accept writes.
    } else if (request.method !== 'GET' && request.method !== 'HEAD') {
      response = new Response('Method not allowed\n', {
        status: 405,
        headers: { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    // 4. Health is a live response and must never be cached.
    } else if (url.pathname === '/health') {
      response = Response.json({ status: 'ok', service: 'proofstream-web', time: new Date().toISOString() }, {
        headers: { 'cache-control': 'no-store' },
      });
    // 5. Hash-based in-page navigation does not depend on trailing HTTP slashes.
    } else if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '') || '/';
      response = new Response(null, { status: 301, headers: { location: url.href } });
    // 6. The receipt checker is a real document, served from receipts.html.
    } else if (url.pathname === '/receipts') {
      response = await fetchAsset(new Request(receiptPageUrl(request), request), env);
    // 7. Cloudflare serves the files, including a real 404 for unknown paths.
    } else {
      response = await fetchAsset(request, env);
    }

    // Security headers and non-canonical noindex apply to every response.
    return secureResponse(response, request);
  },
};

function isReceiptPath(pathname) {
  return pathname === '/.well-known/proofstream-receipt-key.json'
    || pathname === '/api/v1/receipts'
    || pathname === '/api/v1/fingerprints'
    || pathname.startsWith('/api/v1/receipts/');
}

function receiptPageUrl(request) {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = '/receipts.html';
  return assetUrl;
}

async function fetchAsset(request, env) {
  try {
    return await env.ASSETS.fetch(request);
  } catch {
    return new Response('The site is temporarily unavailable. Please try again.\n', {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}
