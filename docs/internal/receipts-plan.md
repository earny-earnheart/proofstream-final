# Signed receipts on proofstream-web

Foundation for D1-backed Ed25519 receipts on the public `proofstream-web` Worker (`cloudflare/`). This does not change `chief-of-staff-dash`, does not create a remote D1 database, does not deploy, and does not add API keys, orgs, auth tiers, or an OpenAPI spec.

## What this adds

A SHA-256 fingerprint can be submitted to the public Worker. The Worker issues a receipt: a new id, the fingerprint, and an issuance time, signed with Ed25519 over a fixed payload, then stored in D1. Anyone can look the receipt up by id and check the signature against the published public key. No account is required.

The creator workspace still fingerprints files on the device. The file is not uploaded. After a local milestone is saved, the page asks `POST /api/v1/fingerprints` for a receipt. If that call fails, the local milestone stays saved.

## Binding and schema

`cloudflare/wrangler.jsonc` binds `PROOFS_DB` to database name `proofstream-proofs`.

`database_id` is the placeholder `00000000-0000-0000-0000-000000000000`. That is not a real database. Replace it with the id printed by `wrangler d1 create` before any deploy. Do not run the create or the remote migration from CI or from this change.

`cloudflare/migrations/0001_receipts.sql` creates `receipts`:

| Column | Role |
| --- | --- |
| `receipt_id` | Primary key, UUID version 4 |
| `fingerprint` | Lowercase SHA-256 hex (64 characters) |
| `issued_at` | Server time, `YYYY-MM-DDTHH:mm:ss.sssZ` |
| `signature` | Base64url Ed25519 signature, unpadded |
| `key_id` | `kid` of the key that signed the receipt |
| `metadata` | Small JSON: algorithm and payload version only |

## Signing

`RECEIPT_SIGNING_KEY` is a Worker secret: base64 (standard or base64url) of an unencrypted PKCS#8 Ed25519 private key. It is never committed. Tests generate a throwaway key in memory.

If the secret is missing, blank, or not a usable key, issuance returns an error and writes nothing. It does not return an unsigned receipt.

The public key is derived from that secret and served at `GET /.well-known/proofstream-receipt-key.json` as a JWK (`kty` OKP, `crv` Ed25519, `x`, `alg` EdDSA, `use` sig, `kid`). `kid` is `ed25519:` plus the first 16 lowercase hex characters of SHA-256 over the raw 32-byte public key. There is no committed public key, so the published key cannot drift from the secret.

Payload version 1 is the UTF-8 string below, four LF separators, no trailing newline:

```text
proofstream-receipt/v1
receipt_id:<uuid>
fingerprint:<64 lowercase hex>
issued_at:<ISO-8601 milliseconds Z>
kid:<key id>
```

The Worker signs those bytes with Ed25519 (WebCrypto). The same string is what a third party verifies.

## HTTP

Existing routes stay as they are. `POST /` is still rejected. Receipt routes are the exception.

| Method and path | Behavior |
| --- | --- |
| `POST /api/v1/fingerprints` | Issue a receipt for `{ "fingerprint": "<64 hex>" }` |
| `POST /api/v1/receipts` | Same issuance |
| `GET /api/v1/receipts/:id` | Stored receipt plus verification result |
| `GET /.well-known/proofstream-receipt-key.json` | Current public JWK |
| `GET /receipts` | Public page: enter a receipt id and see the check |

There is no list endpoint. Lookup is by receipt id only.

Issuance limits: `Content-Type: application/json`, body at most 2048 bytes, one property (`fingerprint`), 64 hex characters. Receipt ids on lookup must be UUID version 4. SQL uses bound parameters.

`GET /api/v1/receipts/:id` re-checks the signature with the current secret. A tampered row is returned with `verified: false` (the signature is rejected). A missing secret on lookup does not report the receipt as verified.

The same-origin page loads `/receipts.js` (no inline script, no third-party asset) and repeats the check in the browser with WebCrypto. The receipt counts as verified on the page only when the browser check and the server check both succeed. The page states the independent procedure: fetch the receipt, fetch the JWK, require matching `kid`, rebuild the payload, base64url-decode the signature, Ed25519-verify. The API does not grant cross-origin reads; another site should use an HTTPS client, not a browser call from a foreign origin.

This write path is account-free on purpose. Until a later auth change, anyone who can reach the Worker can insert a receipt row. Row size is capped; request rate is not. Do not treat a receipt as an authenticated identity or as a notarial act.

## Owner commands

Run these from `cloudflare/` on an authenticated owner machine. This change does not run them.

```sh
npx wrangler@latest d1 create proofstream-proofs
```

Copy the printed `database_id` into `wrangler.jsonc`, replacing `00000000-0000-0000-0000-000000000000`.

```sh
npx wrangler@latest d1 migrations apply proofstream-proofs --remote
```

Optional local copy of the same migration:

```sh
npx wrangler@latest d1 migrations apply proofstream-proofs --local
```

Generate a key on that machine, as its own command. It prints the private key. Do not commit it, paste it into chat, or put it in `wrangler.jsonc`.

```sh
node --input-type=module -e 'import { generateKeyPairSync } from "node:crypto"; const { privateKey } = generateKeyPairSync("ed25519"); process.stdout.write(Buffer.from(privateKey.export({ type: "pkcs8", format: "der" })).toString("base64")); process.stdout.write("\n");'
```

Paste that single line when Wrangler prompts. Run this by itself so a following command is not consumed as the secret:

```sh
npx wrangler@latest secret put RECEIPT_SIGNING_KEY
```

Deploy only when the id, migration, and secret are in place:

```sh
npx wrangler@latest deploy
```

After deploy, `GET /.well-known/proofstream-receipt-key.json` on `https://proofstreamapp.com` publishes the matching public key. Rolling the secret changes `kid`. Older receipts then verify as `key_mismatch` until a future change publishes retired keys. This foundation keeps one current key.
