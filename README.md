# ProofStream

ProofStream creator workspace, IP registration, and an institutional-bond testnet implementation.

- [Implementation, local commands and deployment handoff](docs/bond-implementation.md)
- [Validation and review findings](docs/bond-review-notes.md)
- [Electronic-presentation conditions: bank/counsel draft](docs/mt700-electronic-presentation-draft.md)

Use Node.js 22: `npm ci`, `npm test`, `npm run test:coverage`.
Clean-build deployment artifacts with `npm run clean && npm run bond:export`.
Solidity 0.8.20 and contract dependencies are pinned through npm.

No bond has been publicly issued or deployed. No credentials are needed for local tests.

## Website and launch

- [Published creator workspace](https://proofstream-creator-studio.pantheonconsultinggr.chatgpt.site)
- [Website source and verification](site/README.md)
- [Launch status and domain handoff](docs/launch/status.md)
- [Original user-supplied mockups](references/original-mockups/README.md)

The website uses browser-local storage and has no live blockchain transactions.
The bond contracts are separately tested prototypes; there is no public bond issuance.
The Sites repository remains the publication source; this GitHub repository preserves
the full work for review and ongoing development.

## Direct Cloudflare deployment

The owner-configured `proofstream-web` Worker cutover is packaged in
[cloudflare/](cloudflare/README.md). It preserves apex/www routing, strict security
headers, disabled workers.dev/preview URLs, and a real 404. This supersedes the earlier
Sites-domain DNS plan. Cloudflare publication must be run from the owner’s authenticated
terminal; it has not been executed by this session.
