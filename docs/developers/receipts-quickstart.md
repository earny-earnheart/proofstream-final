# ProofStream signed receipts

This note describes the receipt routes on the `proofstream-web` Worker. It follows the code in [cloudflare/src/receipts-server.js](../../cloudflare/src/receipts-server.js), [cloudflare/src/worker.js](../../cloudflare/src/worker.js), and [cloudflare/public/receipts.js](../../cloudflare/public/receipts.js). Operator setup for the database binding and signing secret is in [docs/internal/receipts-plan.md](../internal/receipts-plan.md).

Availability of a host running this Worker is subject to deployment. Nothing here reports that a deployment is in service.

The Worker’s canonical host string is `proofstreamapp.com`. A request whose hostname is `www.proofstreamapp.com` is answered with `301` and a `Location` of `https://proofstreamapp.com` plus the same path and query. That redirect runs before the receipt handler, so the `www` response does not issue or look up a receipt. Examples below use the canonical host as the base URL the code names. A client that does not follow redirects sees the `301` and no JSON body.

## What a receipt is

A receipt is a row the Worker creates for one submitted SHA-256 fingerprint:

- `receipt_id`: a new UUID version 4 from `crypto.randomUUID()`
- `fingerprint`: the 64-character hex string, stored in lowercase
- `issued_at`: the Worker clock at issuance, from `new Date().toISOString()`
- an Ed25519 signature over the canonical payload below, using the Worker’s current signing key

The signature covers those values and the key id. It does not cover a name, a filename, or the file bytes. The same fingerprint can be submitted again; each success is a new `receipt_id`. Lookup is by `receipt_id` only. There is no list route and no route that searches by fingerprint.

The creator workspace hashes a file on the device and, after the local milestone is saved, `POST`s that hex string to `/api/v1/fingerprints`. The file is not part of the request. The workspace keeps a receipt id on that milestone only when the response is successful, `verified` is true, and `receipt.receipt_id` matches the UUID version 4 pattern. Otherwise the local milestone stays saved and no receipt id is stored.

## What a receipt is not

A receipt is not an authenticated identity. Issuance does not read an account, session, cookie, or API key. The signature does not name a person.

A receipt is not a notarial act. It is an Ed25519 signature over the canonical payload, stored with the fingerprint.

## Compute a fingerprint locally

The workspace fingerprint is SHA-256 over the file’s raw bytes, written as 64 lowercase hex characters, with no `0x` prefix. Hash the bytes you care about. These commands do that and print only the hex:

```sh
shasum -a 256 path/to/file | awk '{print $1}'
sha256sum path/to/file | awk '{print $1}'
```

Node.js, no packages:

```js
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const bytes = await readFile(process.argv[2]);
process.stdout.write(`${createHash('sha256').update(bytes).digest('hex')}\n`);
```

```sh
node hash-file.mjs path/to/file
```

`shasum` and `sha256sum` already emit lowercase hex. The issuance route also accepts `A`–`F` and stores the lowercase form. The signed payload uses that lowercase form. A leading `0x` is rejected.

The workspace refuses a file larger than 25 MiB (`25 * 1024 * 1024` bytes) before it hashes. The receipt route never sees the file. Its limit is the JSON body size below.

## Issue a receipt

`POST /api/v1/fingerprints` creates one receipt. `POST /api/v1/receipts` calls the same function. `GET /api/v1/receipts` is not a list; the collection path allows only `POST`.

### Request

Required request header:

```http
Content-Type: application/json
```

The media type, with parameters removed, must be `application/json`. Comparison is case-insensitive, and whitespace around the media type is ignored. `application/json; charset=utf-8` is accepted. The body is decoded as UTF-8. A charset parameter does not change that decoder.

`curl --data` sends `Content-Type: application/x-www-form-urlencoded` unless you set the header yourself. Set it.

The handler does not read `Accept`, `Authorization`, or an API key. The workspace sends `Accept: application/json`; the route ignores it.

Body, one JSON object, one property:

```json
{"fingerprint":"<64 hex characters>"}
```

`fingerprint` must be a string of exactly 64 characters in `0-9`, `a-f`, or `A-F`. The parsed object must have exactly one own property, and that property’s name must be `fingerprint`.

```sh
FINGERPRINT="$(sha256sum path/to/file | awk '{print $1}')"
curl -sS -D - \
  -X POST \
  -H 'Content-Type: application/json' \
  --data "{\"fingerprint\":\"${FINGERPRINT}\"}" \
  'https://proofstreamapp.com/api/v1/fingerprints'
```

The path is exact. `POST /api/v1/fingerprints/` does not enter the receipt handler. A `POST` on that path is the site’s plain-text `405` (`Allow: GET, HEAD`, body `Method not allowed\n`), not the JSON error from the receipt route.

### Limits and check order

The first failing check is the response. Order:

1. Method is `POST`. Anything else is `405`.
2. `Content-Type` is JSON, or `415`.
3. Body size, or `413`.
4. The bytes are UTF-8 and parse as JSON, or `400` `invalid_json`.
5. The value is a JSON object with exactly one property, `fingerprint`, or `400` `invalid_request`.
6. `fingerprint` matches the 64-hex rule, or `400` `invalid_fingerprint`.
7. The signing secret loads, or `503`.
8. The D1 binding is present, or `503`.
9. Ed25519 sign and a local verify of that signature succeed, or `500`.
10. The insert reports a change, or `503`.

Body size:

- The maximum is 2048 bytes (`MAX_BODY_BYTES`).
- If `Content-Length` is present, it must be a string of digits whose numeric value is at most 2048. Any other `Content-Length` is `413` `body_too_large`, including a non-numeric value and a value above 2048 paired with a shorter body.
- The bytes actually read are also capped at 2048.
- A leading U+FEFF is stripped before `JSON.parse`.

The client does not choose `receipt_id`, `issued_at`, or the signature. `issued_at` is the Worker clock in the form `YYYY-MM-DDTHH:mm:ss.sssZ` (24 characters, millisecond fraction, `Z`). The code does not record a time source beyond that clock. Any claim about clock synchronization is TBD — confirm with core team.

There is no idempotency key. A second `POST` of the same fingerprint creates another row.

### Success response

HTTP `201`. `Content-Type` is `application/json; charset=utf-8`. `Cache-Control` is `no-store`. The Worker also sets its usual response security headers on this response (HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Content-Security-Policy`).

The JSON samples in this note use illustrative ids, fingerprints, timestamps, and key ids. They are the field layout, not a stored receipt.

```json
{
  "receipt": {
    "receipt_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "fingerprint": "abababababababababababababababababababababababababababababababab",
    "issued_at": "2026-11-24T18:38:00.123Z",
    "key_id": "ed25519:0123456789abcdef",
    "signature": "<86 unpadded base64url characters>",
    "algorithm": "Ed25519",
    "payload_version": 1
  },
  "verified": true,
  "verification": {
    "ok": true,
    "reason": "valid",
    "algorithm": "Ed25519",
    "key_id": "ed25519:0123456789abcdef",
    "payload_version": 1
  }
}
```

On issuance, `verification.key_id` is the same kid as `receipt.key_id`. `algorithm` on the receipt is the string `Ed25519`. The public JWK’s `alg` is `EdDSA`. Those are the two strings the code sets.

The JSON object does not include the database `metadata` column. The handler stores `{"algorithm":"Ed25519","payload_version":1}` in that column and copies `algorithm` and `payload_version` onto the receipt object itself.

A failure of issuance does not include a `receipt` object and does not return an unsigned receipt.

### Issuance errors

`fail` responses are JSON `{ "error": "<code>", "verified": false }` with the status below. They have no `receipt` property.

| Status | `error` | When |
| --- | --- | --- |
| 415 | `unsupported_media_type` | `Content-Type` is missing or its media type is not `application/json` |
| 413 | `body_too_large` | `Content-Length` is not an integer string of at most 2048, or the body exceeds 2048 bytes |
| 400 | `invalid_json` | The body is not valid UTF-8, or `JSON.parse` fails (including an empty body) |
| 400 | `invalid_request` | The JSON value is not an object, is an array, or does not have exactly one own property named `fingerprint` |
| 400 | `invalid_fingerprint` | `fingerprint` is not a string of 64 hex characters. A `0x` prefix, 63 characters, and non-hex characters take this code |
| 503 | `signing_key_unavailable` | `RECEIPT_SIGNING_KEY` is missing, not a string, or blank. Nothing is stored |
| 503 | `signing_key_invalid` | The secret is not a usable PKCS#8 Ed25519 private key. Nothing is stored |
| 500 | `receipt_signing_failed` | `crypto.subtle.sign` throws, or the fresh signature fails the local verify. Nothing is stored |
| 503 | `receipt_store_unavailable` | `PROOFS_DB` is missing, the insert throws, or the insert reports zero changes. The response has no receipt |
| 405 | `method_not_allowed` | The method is not `POST`. The `Allow` header is `POST` |
| 500 | `receipt_unavailable` | The Worker’s receipt `try/catch` fires because the handler throws. Body is `{ "error": "receipt_unavailable", "verified": false }` |

The route does not return `401`, `403`, or `429`.

## Look up a receipt

```http
GET /api/v1/receipts/<receipt id>
```

No request header is required. The path segment is lowercased, then checked against a UUID version 4 pattern: 8-4-4-4-12 lowercase hex, the version nibble is `4`, and the variant nibble is `8`, `9`, `a`, or `b`.

```sh
curl -sS -D - \
  'https://proofstreamapp.com/api/v1/receipts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
```

`HEAD` is allowed and returns the same status and headers with an empty body. Any other method on a single path segment is `405` with `Allow: GET, HEAD`.

Path checks run in this order:

1. An empty segment, or a segment that contains `/`, is `404` `receipt_not_found` for every method.
2. A method other than `GET` or `HEAD` is `405` `method_not_allowed`.
3. A segment that is not a UUID version 4 is `400` `invalid_receipt_id`.
4. Otherwise the row is loaded and checked.

There is no query-string parameter. `?id=` is not read.

### Response when the row and the signing key both load

HTTP `200`, including when the signature check fails. `Cache-Control` is `no-store`. The receipt object’s fields are `receipt_id`, `fingerprint`, `issued_at`, `signature`, `key_id`, `algorithm` (`Ed25519`), and `payload_version` (`1`). Lookup places `signature` before `key_id`. Issuance places `key_id` before `signature`. The names are the same.

`verification.key_id` is the **current** public key’s kid (the key just loaded from the signing secret). It is not read from the row. On a match it equals `receipt.key_id`. On `key_mismatch` the two kids differ.

Verified:

```json
{
  "receipt": {
    "receipt_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "fingerprint": "abababababababababababababababababababababababababababababababab",
    "issued_at": "2026-11-24T18:38:00.123Z",
    "signature": "<86 unpadded base64url characters>",
    "key_id": "ed25519:0123456789abcdef",
    "algorithm": "Ed25519",
    "payload_version": 1
  },
  "verified": true,
  "verification": {
    "ok": true,
    "reason": "valid",
    "algorithm": "Ed25519",
    "key_id": "ed25519:0123456789abcdef",
    "payload_version": 1
  }
}
```

`key_mismatch` is still HTTP `200`. `verified` is `false`. `verification.reason` is `key_mismatch`. `verification.key_id` is the current kid. `receipt.key_id` is the kid stored on the row. The signature is not checked once the kids differ. Replacing the signing secret causes this for rows signed by the previous key. This code publishes one current key and does not serve retired keys.

`signature_mismatch` is also HTTP `200` with `verified: false`. The stored row is still returned. A changed fingerprint or a different 86-character signature produces this reason when the kid still matches.

`malformed_receipt` is HTTP `200` with `verified: false` when the stored fields fail the verifier’s grammar (id, lowercase fingerprint, kid pattern, canonical timestamp, or 86-character unpadded base64url signature) after the kid has matched. `malformed_key` is a reason the same verifier returns when the JWK it was given cannot be used. Lookup calls that verifier only after the signing secret has loaded; a secret that does not load takes the `503` shape below instead of `malformed_key`.

The verifier’s check order, which lookup copies into `verification.reason`, is:

1. `receipt.key_id` must equal the JWK `kid`, or `key_mismatch`.
2. The receipt fields must match the grammar, or `malformed_receipt`.
3. The signature must base64url-decode to 64 bytes, or `malformed_receipt`.
4. Ed25519 verify over the canonical payload, or `signature_mismatch`. Success is `valid`.

### Lookup errors

| Status | Body | When |
| --- | --- | --- |
| 400 | `{ "error": "invalid_receipt_id", "verified": false }` | The single path segment is not a UUID version 4 after lowercasing |
| 404 | `{ "error": "receipt_not_found", "verified": false }` | No row for that id, or the path has an empty or extra segment |
| 405 | `{ "error": "method_not_allowed", "verified": false }` | Method is not `GET` or `HEAD`. `Allow` is `GET, HEAD` |
| 503 | `{ "error": "receipt_store_unavailable", "verified": false }` | The D1 binding is missing or the select throws. No `receipt` property |
| 503 | See below | A row exists, and the signing secret is missing or unusable |
| 500 | `{ "error": "receipt_unavailable", "verified": false }` | The Worker’s receipt `try/catch` fires |

When a row exists but the signing secret does not load, the status is `503` and the stored receipt is included. `verified` is `false`. `verification` has only `ok` and `reason` (the same code as `error`). It does not include `algorithm`, `key_id`, or `payload_version`.

```json
{
  "error": "signing_key_unavailable",
  "receipt": {
    "receipt_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "fingerprint": "abababababababababababababababababababababababababababababababab",
    "issued_at": "2026-11-24T18:38:00.123Z",
    "signature": "<86 unpadded base64url characters>",
    "key_id": "ed25519:0123456789abcdef",
    "algorithm": "Ed25519",
    "payload_version": 1
  },
  "verified": false,
  "verification": { "ok": false, "reason": "signing_key_unavailable" }
}
```

`signing_key_invalid` uses that same shape with both `error` and `verification.reason` set to `signing_key_invalid`. This response does not report the receipt as verified.

`GET /receipts` is an HTML page that runs this lookup in the browser. It is not the JSON route. The page treats a receipt as verified only when its browser check and the server’s `verified` flag are both true. Responses from the Worker do not include `Access-Control-Allow-Origin`.

## Public key

```http
GET /.well-known/proofstream-receipt-key.json
```

`HEAD` is allowed and returns an empty body. Any other method is `405` with `Allow: GET, HEAD`.

```sh
curl -sS -D - \
  'https://proofstreamapp.com/.well-known/proofstream-receipt-key.json'
```

HTTP `200` is the JWK itself, not wrapped in another object. `Cache-Control` is `no-store`. The private key is not included.

```json
{
  "kid": "ed25519:0123456789abcdef",
  "kty": "OKP",
  "crv": "Ed25519",
  "alg": "EdDSA",
  "use": "sig",
  "x": "<base64url public key>"
}
```

`kid` is `ed25519:` plus the first 16 lowercase hex characters of SHA-256 over the raw 32-byte public key. `x` is the public key from the WebCrypto JWK export of that same key. The secret never leaves the Worker; this document does not contain it.

If the signing secret is missing, the status is `503` and the body is `{ "error": "signing_key_unavailable", "verified": false }`. If the secret is not a usable Ed25519 key, the error is `signing_key_invalid` with the same status and shape. The Worker’s receipt `try/catch` can also return `500` `receipt_unavailable`.

## Verify offline

Do this with the receipt JSON and the JWK. Do not treat the server’s `verified` flag as the check. The page’s browser script and [docs/developers/examples/verify-receipt.mjs](examples/verify-receipt.mjs) both follow [cloudflare/public/receipts.js](../../cloudflare/public/receipts.js).

### Canonical payload, version 1

UTF-8. Five lines joined by LF (`\n`). Four separators. No trailing newline.

```text
proofstream-receipt/v1
receipt_id:<uuid v4, lowercase>
fingerprint:<64 lowercase hex characters>
issued_at:<YYYY-MM-DDTHH:mm:ss.sssZ>
kid:<key id>
```

`issued_at` must match that pattern and must round-trip through `new Date(value).toISOString()`. `2026-11-24T18:38:00Z` (no milliseconds) does not. The values are the receipt fields: `receipt_id`, `fingerprint`, `issued_at`, and `key_id`. Build the payload from the receipt, including the receipt’s own `key_id`, not from `verification.key_id`.

The Worker signs those UTF-8 bytes with WebCrypto Ed25519. The caller does not hash the payload first. Ed25519’s own hash runs inside the verify operation.

### Base64url signature

The stored signature is unpadded base64url and matches `^[A-Za-z0-9_-]{86}$`. That length is a 64-byte Ed25519 signature without `=` padding.

To decode:

1. Reject the string unless every character is `A`–`Z`, `a`–`z`, `0`–`9`, `-`, or `_`. `+`, `/`, and `=` are rejected.
2. Append `=` until the length is a multiple of 4.
3. Replace `-` with `+` and `_` with `/`.
4. Base64-decode to bytes.
5. Require 64 bytes.

### Kid matching

Before the signature is checked, `receipt.key_id` must equal the JWK `kid`. If they differ, the result is `key_mismatch` and the signature is not checked.

The issuer sets `kid` to `ed25519:` plus the first 16 lowercase hex characters (8 bytes) of SHA-256 over the raw 32-byte public key. WebCrypto’s raw export of an Ed25519 public key is those 32 bytes; the JWK `x` parameter is the base64url form of the same bytes. `verifyReceipt` compares the two kid strings. It does not re-hash `x`.

### Example script

[docs/developers/examples/verify-receipt.mjs](examples/verify-receipt.mjs) takes a receipt id and an optional base URL. The default base URL is `https://proofstreamapp.com`. It requests `/api/v1/receipts/<id>` and `/.well-known/proofstream-receipt-key.json` on that URL’s origin, rebuilds the payload, and verifies with WebCrypto Ed25519. It needs Node.js 18.4 or newer because that is the Node.js release that added Ed25519 to WebCrypto, and it needs no packages.

```sh
node docs/developers/examples/verify-receipt.mjs <receipt-id>
node docs/developers/examples/verify-receipt.mjs <receipt-id> https://proofstreamapp.com
```

Exit status `0` means the local check returned `valid`. Any other result exits `1`. The decision is the local check, not the server’s `verified` field. On success the script writes one JSON object to stdout:

```json
{
  "ok": true,
  "reason": "valid",
  "receipt_id": "...",
  "fingerprint": "...",
  "issued_at": "...",
  "key_id": "...",
  "server_verified": true
}
```

`server_verified` copies the lookup response’s `verified` value. On failure the script writes a one-line reason to stderr (`invalid receipt id`, `receipt lookup failed: <code>`, `public key lookup failed: <code>`, `verification failed: <reason>`, or a request error). Fetch follows redirects, so a `www` host that answers `301` is followed to the canonical host; a client that does not follow redirects stops at the `301`.

The script’s payload builder and verifier are the ones covered by [docs/developers/examples/verify-receipt.test.mjs](examples/verify-receipt.test.mjs), which runs offline with a throwaway key:

```sh
node --test docs/developers/examples/verify-receipt.test.mjs
```

## Current limitations

Issuance is currently unauthenticated and not rate-limited, pending core review. Anyone who can reach a Worker that has the signing secret and the database binding can insert a row. The JSON body is capped at 2048 bytes. The code does not implement a request-rate limit, and it does not return `429`.

API keys and orgs are planned but not available. This code does not read an API key and does not scope a receipt to an org. The request and response shape for that later work is TBD — confirm with core team.

Key rotation changes `kid`. Lookup compares the stored `key_id` with the current public key and returns `key_mismatch` (HTTP `200`, `verified: false`) for receipts signed by the previous key. This code publishes one current JWK. It does not publish retired keys.

How long a receipt row is kept is not in this code. There is no delete route and no expiry column. TBD — confirm with core team.

Availability of any host that runs this Worker is subject to deployment.
