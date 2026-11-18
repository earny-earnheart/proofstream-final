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
shared accounts, independent witnesses, blockchain registration,
pinning, identity registration, payments or a bond offering. Examples are labeled.
A signed receipt can be issued for a SHA-256 fingerprint and checked by anyone at
`/receipts`. The D1 database behind that receipt is not created yet. See
[docs/internal/receipts-plan.md](../docs/internal/receipts-plan.md). The placeholder
`database_id` in `wrangler.jsonc` is not a real database.
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
server and are not standalone crawlable pages. `/` and `/receipts` are the crawlable documents in sitemap.xml.
Hash routes are not listed. Unknown server paths must stay real HTTP 404 responses.

The Worker redirects www first, then serves the signed-receipt API
(`POST /api/v1/receipts`, `POST /api/v1/fingerprints`, `GET /api/v1/receipts/:id`,
and `GET /.well-known/proofstream-receipt-key.json`). Every other path still
allows only GET and HEAD. It serves `/health` and `/receipts`,
normalizes trailing slashes and delegates assets. Security headers decorate all
responses, including redirects, errors and health. Asset content type and ETag are
preserved. No inline scripts/styles, `unsafe-inline` or `unsafe-eval` are needed:
waveform heights use static CSS classes. Contact and company text are supplied by
the owner; no claim of statutory notarization is made.

## Signed receipts — owner setup, not run by this change

`database_id` `00000000-0000-0000-0000-000000000000` is a placeholder. Do not deploy
until it is replaced, the migration is applied, and `RECEIPT_SIGNING_KEY` is set.
Do not commit the private key. Full design and verification steps are in
`docs/internal/receipts-plan.md`.

```sh
npx wrangler@latest d1 create proofstream-proofs
```

Put the printed id in `wrangler.jsonc` (`PROOFS_DB` / `proofstream-proofs`), then apply
the migration:

```sh
npx wrangler@latest d1 migrations apply proofstream-proofs --remote
```

Generate the key in its own step. It prints the private key. Do not commit it.

```sh
node --input-type=module -e 'import { generateKeyPairSync } from "node:crypto"; const { privateKey } = generateKeyPairSync("ed25519"); process.stdout.write(Buffer.from(privateKey.export({ type: "pkcs8", format: "der" })).toString("base64")); process.stdout.write("\n");'
```

Paste that single line when Wrangler prompts. Run this by itself so the next
command is not read as the secret:

```sh
npx wrangler@latest secret put RECEIPT_SIGNING_KEY
```

Deploy only after the id, migration, and secret are in place:

```sh
npx wrangler@latest deploy
```

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

## Original brand asset

The supplied JPG is served at `/logo/proofstream-logo.jpg` without modification. CSS displays a proportional viewport around the wordmark, with navy/cyan interface colors. This package updates the Cloudflare site; the earlier Sites preview is a separate deployment.
