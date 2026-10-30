# ProofStream: existing Cloudflare Worker cutover

This complete project replaces the placeholder in the existing `proofstream-web`
Worker with the ProofStream creator-workspace design. No frontend build is required.
All assets are local and included under `public/`.

## What works today

Projects, milestones, browser-local SHA-256 fingerprinting, creator-specific local
verification, JSON record exports, category filtering, project search and optional
wallet-address connection. Files are read locally and are never uploaded. Connecting
a wallet does not request a signature or transaction.

This concept uses browser-local storage and the device clock. It does not provide
shared accounts, database storage, independent witnesses, blockchain registration,
pinning, identity registration, payments or a bond offering. Examples are labeled.
Cryptographic attestation and blockchain anchoring are in development; these are
not statutory notarial acts. Records stored under the previous chatgpt.site hostname
will not automatically appear on proofstreamapp.com: export them before switching.
The current concept exports records but does not yet import them.

## Deployment target and routing

- Account: Pantheon Enterprise, `7914583bf80f67154ca9364681c0af85`.
- Existing Worker: `proofstream-web` (do not create a new name).
- Apex: `https://proofstreamapp.com`.
- `www.proofstreamapp.com` redirects to apex, preserving path and query.
- `workers.dev` and preview URLs stay disabled.
- Exactly two Custom Domain routes; no wildcard route.
- No DNS, nameserver, other Worker, Zero Trust, WAF or Bot setting changes.

`404-page` is intentional: the app uses hash navigation (`/#verify`, `/#library`,
`/#project/...`) inside the single root page. Hash fragments are never sent to the
server and are not standalone crawlable pages. Only `/` belongs in sitemap.xml;
unknown server paths must stay real HTTP 404 responses.

The Worker redirects www first, then restricts methods to GET/HEAD, serves `/health`,
normalizes trailing slashes and delegates assets. Security headers decorate all
responses, including redirects, errors and health. Asset content type and ETag are
preserved. No inline scripts/styles, `unsafe-inline` or `unsafe-eval` are needed:
waveform heights use static CSS classes. Contact and company text are supplied by
the owner; no claim of statutory notarization is made.

## Exact commands (run from this folder)

1. Check the files/tests locally:
   ```sh
   node --test tests/*.test.mjs
   ```
2. Authenticate on your own computer (never send a token or seed phrase in chat):
   ```sh
   npx wrangler@latest login
   npx wrangler@latest whoami
   ```
   Confirm the listed account includes `7914583bf80f67154ca9364681c0af85`.
3. Inspect current deployments and retain the output as the rollback record:
   ```sh
   npx wrangler@latest deployments list
   ```
4. Validate the package before cutover:
   ```sh
   npx wrangler@latest deploy --dry-run
   ```
5. Replace the existing placeholder:
   ```sh
   npx wrangler@latest deploy
   ```
6. Check the public result:
   ```sh
   bash scripts/verify-production.sh
   ```

There is no `npm install` or frontend build step for this buildless project. `npx`
fetches Wrangler when needed. The `package.json` only selects ES modules and test
commands. Node.js 22 is recommended. Review any Wrangler prompt against the fixed
worker name and the two declared Custom Domains before continuing.

## Rollback

Run from this same folder:

```sh
npx wrangler@latest rollback
```

Choose the previous known-good placeholder deployment from the history captured
above. Alternatively: Cloudflare Dashboard → Workers & Pages → proofstream-web →
Deployments → select the previous version → Roll back. Rollback requires a previous
version to be retained by Cloudflare; record it before cutover.

## Source of truth

This is the direct Cloudflare deployment requested in the supplied brief. The Sites
copy remains a separate public demo. Do not apply the earlier Sites A/TXT routing
instructions to this Worker cutover; the domain owner has configured Cloudflare.
GitHub preserves this project; a GitHub push alone does not deploy it.
