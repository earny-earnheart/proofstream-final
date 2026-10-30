# Prompt for ChatGPT: Deploy the ProofStream site to Cloudflare Workers

> Copy everything below the line into ChatGPT, in the same conversation where it built the ProofStream website.

---

## Role and objective

You built the ProofStream website earlier in this conversation. Now package and deploy it to **Cloudflare Workers** so it replaces the current placeholder at **https://proofstreamapp.com**. Keep the production routing, SEO and security behavior that is already live; that behavior is listed below and must survive the cutover.

If you can't run commands yourself, give me a complete, ready-to-run project (every file in full, no placeholders except where marked `<<FILL>>`) and the exact terminal commands in order. I'll run them and paste the output back to you.

## Target environment (fixed, do not change)

| Item | Value |
|---|---|
| Cloudflare account | Pantheon Enterprise, `7914583bf80f67154ca9364681c0af85` |
| Worker name | `proofstream-web` (overwrite this existing Worker; do **not** create a new one) |
| Production domains | `proofstreamapp.com` (canonical) and `www.proofstreamapp.com` (both already attached as Custom Domains) |
| workers.dev URL | **Disabled**, and it must stay disabled |
| Preview URLs | **Disabled** |
| Wildcard routes | None. Do **not** add `*.proofstreamapp.com/*` |
| Deploy tool | Wrangler v4 (`npx wrangler@latest`), authenticated by `wrangler login` on my machine |

## Required architecture

Use **Workers Static Assets** with a thin Worker in front:

1. Put the built site in `./public` (or the framework's build output, such as `dist/` or `out/`). If the site uses a framework (React/Vite/Next static export/Astro, etc.), include the build step and point `assets.directory` at the output folder.
2. `wrangler.jsonc` must contain:
   - `"name": "proofstream-web"`
   - `"account_id": "7914583bf80f67154ca9364681c0af85"`
   - `"main": "src/worker.js"`
   - `"compatibility_date"`: today's date
   - `"assets": { "directory": "<build dir>", "binding": "ASSETS", "run_worker_first": true, "not_found_handling": "404-page" }`. Use `"single-page-application"` **only** if the site uses client-side routing, and say which you chose and why.
   - `"workers_dev": false`, `"preview_urls": false`
   - `"routes": [ { "pattern": "proofstreamapp.com", "custom_domain": true }, { "pattern": "www.proofstreamapp.com", "custom_domain": true } ]`
3. `src/worker.js` (ES module) must, in this order:
   1. **Redirect `www` → apex**, with a 301 that keeps the path and query.
   2. **Restrict methods:** allow only `GET` and `HEAD`; anything else returns `405` with `Allow: GET, HEAD`. (Exception: if the site has a real form/API endpoint, list it explicitly and allow `POST` only on that path.)
   3. **`/health`:** return `200` JSON `{"status":"ok","service":"proofstream-web","time":"<ISO>"}` with `cache-control: no-store`.
   4. **Trailing slashes:** strip them from non-root paths with a 301. Skip this if the framework's routing depends on trailing slashes, and say so.
   5. **Serve everything else** via `env.ASSETS.fetch(request)`.
   6. **Security headers:** add these to every response, merged onto the asset response without dropping its `content-type` or `etag`:
      - `strict-transport-security: max-age=31536000; includeSubDomains`
      - `x-content-type-options: nosniff`
      - `x-frame-options: DENY`
      - `referrer-policy: strict-origin-when-cross-origin`
      - `permissions-policy: camera=(), microphone=(), geolocation=()`
      - `content-security-policy`: **build it from what the site actually loads.** Start from `default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'` and add only the specific origins the site needs (fonts, analytics, form endpoint, images). No `unsafe-eval`. Use `unsafe-inline` only if unavoidable, and say why.
   7. **Non-canonical hosts:** if the host is not exactly `proofstreamapp.com`, add `x-robots-tag: noindex, nofollow`.

## Files that must exist in the deployed site

These are live now and must not regress. Create them as static files in the build directory unless the site already provides them:

- `/robots.txt`, containing:
  ```
  User-agent: *
  Allow: /

  Sitemap: https://proofstreamapp.com/sitemap.xml
  ```
- `/sitemap.xml`: list **every** public page of the new site with absolute `https://proofstreamapp.com/...` URLs.
- `/.well-known/security.txt`:
  ```
  Contact: mailto:pantheonconsultinggroup@gmail.com
  Expires: 2027-10-30T00:00:00.000Z
  Preferred-Languages: en
  Canonical: https://proofstreamapp.com/.well-known/security.txt
  ```
- `/favicon.ico` **and** `/favicon.svg`: use the site's own icon. If it has none, use a gold (`#C8A96E`) "P" on `#0d0d0f`.
- `/404.html`: a branded page that includes `<meta name="robots" content="noindex">`. Unknown paths must return HTTP **404**, not 200.
- Every HTML page needs `<link rel="canonical" href="https://proofstreamapp.com/<path>">`, a `<meta name="description">`, and `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`.

## Content and compliance guardrails

- Brand: **ProofStream**, a product of **Pantheon Consulting Group, Inc.** (Wyoming). Contact phone, if shown: 307-357-0957. Website of the parent: pantheonconsultinggroup.net.
- Wherever the site describes attestation, keep the standing distinction: ProofStream provides **cryptographic attestation and blockchain anchoring**. It is **not** a statutory notarial act. Don't use the words "notarize" or "notarized" unless they carry that qualifier.
- Don't claim features are live that aren't. Fingerprinting and verification work today. Pin, attest, anchor, identity registration and monetization are **not yet live**, so label them "coming soon" or "in development" if they appear.
- Don't include API keys, wallet private keys, JWTs or any secret in client-side code or in the repo.

## Deliverables (in this order)

1. **File tree** of the deploy project.
2. **Every file in full:** `wrangler.jsonc`, `src/worker.js`, `package.json` (if a build is needed), the static files above, plus the site itself.
3. **Commands**, numbered, from a clean folder:
   ```
   npm install            # only if there's a build step
   npm run build          # only if there's a build step
   npx wrangler@latest login
   npx wrangler@latest deploy --dry-run
   npx wrangler@latest deploy
   ```
4. **Post-deploy verification script** (bash, using `curl`) that checks and prints PASS/FAIL for each:
   - `https://proofstreamapp.com/` returns 200 and the HTML contains the new site's `<title>`
   - `https://www.proofstreamapp.com/some/path?x=1` returns 301 to `https://proofstreamapp.com/some/path?x=1`
   - `/robots.txt` is 200 `text/plain`; `/sitemap.xml` is 200 XML; `/.well-known/security.txt` is 200; `/favicon.ico` is 200; `/health` is 200 JSON
   - `/definitely-not-a-page` returns **404**
   - `POST /` returns 405
   - the response headers on `/` include `strict-transport-security`, `content-security-policy` and `x-frame-options: DENY`
   - `https://proofstream-web.pantheon-platform.workers.dev/` does **not** return 200 (workers.dev stays off)
5. **Rollback:** the exact command (`npx wrangler@latest rollback`) and the dashboard path (Workers & Pages → proofstream-web → Deployments) to restore the previous version (the current placeholder) if anything fails.

## Constraints

- Don't touch DNS records, other Workers (`chief-of-staff-dash`, `api-mcp-gate-pcg`, `pcg-credential-gate`, `edge-items-api`, `earnheart-gateway`), Zero Trust/Access, or WAF/Bot settings.
- Don't enable workers.dev or preview URLs. Don't add routes beyond the two Custom Domains.
- If anything in your site conflicts with these requirements (for example, it needs a backend, a database, or third-party scripts), **stop and list the conflicts** before generating the deploy package.
