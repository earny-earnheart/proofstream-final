# ProofStream Creator Studio

A buildless, responsive creator workspace based on the supplied ProofStream user-flow,
business-model and original contract references. Production files live in `dist/`.

## Features

- Project library with discipline filters and search.
- Browser-local project creation and milestone timelines.
- SHA-256 file fingerprinting through Web Crypto, with a 25 MB limit.
- Creator-specific verification against local records; example records excluded.
- Project JSON export (metadata and fingerprints, not original files).
- Optional wallet-address connection through an injected wallet provider; no signing
  requests, payments or blockchain transactions.
- Development roadmap and privacy/workflow explanations.

The initial three projects are illustrative. New records use localStorage and the
device clock; no backend, uploaded files, subscriptions or shared witness flows exist.
Clearing browser data removes local records. Local records are not proof of ownership.

## Development

No build or install step is required. Serve `dist/` from HTTPS or localhost for Web
Crypto. `.openai/hosting.json` identifies the Sites project (currently public). Publish exactly
these static files alongside the hosting manifest. Keep site identity unchanged.

## Verification

Run `npm ci --prefix qa && node qa/check.cjs` from this directory for the DOM
interaction checks. These use jsdom and do not replace visual browser testing.

This folder is a GitHub snapshot of the live Sites source. The Sites-managed
repository remains the publication source; pushing this GitHub branch does not
automatically deploy the site.
