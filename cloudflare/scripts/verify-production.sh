#!/usr/bin/env bash
# Read-only checks. No auth, DNS changes, Worker mutations or form submissions.
# POST / intentionally probes rejection and carries no request body.
set -u
set -o pipefail

command -v curl >/dev/null 2>&1 || { echo 'FAIL: curl is required'; exit 1; }
TMP_DIR=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP_DIR"' EXIT
FAILURES=0
STATUS=''
HEADERS="$TMP_DIR/headers"
BODY="$TMP_DIR/body"
ORIGIN='https://proofstreamapp.com'

report() {
  local result="$1" label="$2"
  if [[ "$result" == 'PASS' ]]; then printf 'PASS: %s\n' "$label";
  else printf 'FAIL: %s\n' "$label"; FAILURES=$((FAILURES + 1)); fi
}
fetch_url() {
  local url="$1" method="${2:-GET}"
  : > "$HEADERS"; : > "$BODY"; STATUS=''
  # Do not follow redirects: their exact status and location are part of the checks.
  if ! STATUS=$(curl --silent --show-error --connect-timeout 10 --max-time 30 \
      --request "$method" --dump-header "$HEADERS" --output "$BODY" \
      --write-out '%{http_code}' "$url"); then
    STATUS='NETWORK_ERROR'
    return 1
  fi
  # Avoid treating an incomplete transfer or network failure as a disabled endpoint.
  [[ "$STATUS" =~ ^[1-5][0-9][0-9]$ ]]
}
header_matches() { grep -Eiq "$1" "$HEADERS"; }

if fetch_url "$ORIGIN/" && [[ "$STATUS" == 200 ]] && grep -Fq '<title>ProofStream — Your work. Your timeline.</title>' "$BODY"; then
  report PASS 'Homepage returns 200 and the new ProofStream title'
else report FAIL "Homepage content (HTTP $STATUS)"; fi

if header_matches '^strict-transport-security:[[:space:]]*max-age=31536000; includeSubDomains[[:space:]]*$' \
    && header_matches '^content-security-policy:' \
    && header_matches '^x-frame-options:[[:space:]]*DENY[[:space:]]*$' \
    && header_matches '^x-content-type-options:[[:space:]]*nosniff[[:space:]]*$'; then
  report PASS 'Homepage security headers'
else report FAIL 'Homepage security headers'; fi

if fetch_url 'https://www.proofstreamapp.com/some/path?x=1' && [[ "$STATUS" == 301 ]] \
    && header_matches '^location:[[:space:]]*https://proofstreamapp\.com/some/path\?x=1[[:space:]]*$' \
    && header_matches '^x-robots-tag:[[:space:]]*noindex, nofollow[[:space:]]*$'; then
  report PASS 'www redirects to apex with path/query preserved and noindex'
else report FAIL "www canonical redirect (HTTP $STATUS)"; fi

if fetch_url "$ORIGIN/robots.txt" && [[ "$STATUS" == 200 ]] \
    && header_matches '^content-type:[[:space:]]*text/plain([;[:space:]]|$)' \
    && grep -Fq 'Sitemap: https://proofstreamapp.com/sitemap.xml' "$BODY"; then
  report PASS 'robots.txt: 200 text/plain with canonical sitemap'
else report FAIL "robots.txt (HTTP $STATUS)"; fi

if fetch_url "$ORIGIN/sitemap.xml" && [[ "$STATUS" == 200 ]] \
    && header_matches '^content-type:[[:space:]]*(application|text)/xml([;[:space:]]|$)' \
    && grep -Fq '<loc>https://proofstreamapp.com/</loc>' "$BODY"; then
  report PASS 'sitemap.xml: 200 XML with canonical homepage'
else report FAIL "sitemap.xml (HTTP $STATUS)"; fi

if fetch_url "$ORIGIN/.well-known/security.txt" && [[ "$STATUS" == 200 ]] \
    && grep -Fq 'Contact: mailto:pantheonconsultinggroup@gmail.com' "$BODY"; then
  report PASS 'security.txt: 200 with security contact'
else report FAIL "security.txt (HTTP $STATUS)"; fi

for asset in favicon.ico favicon.svg; do
  if fetch_url "$ORIGIN/$asset" && [[ "$STATUS" == 200 ]] && [[ -s "$BODY" ]]; then
    report PASS "$asset: 200 and non-empty"
  else report FAIL "$asset (HTTP $STATUS)"; fi
done

if fetch_url "$ORIGIN/health" && [[ "$STATUS" == 200 ]] \
    && header_matches '^content-type:[[:space:]]*application/json([;[:space:]]|$)' \
    && header_matches '^cache-control:[[:space:]]*no-store[[:space:]]*$' \
    && grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' "$BODY" \
    && grep -Eq '"service"[[:space:]]*:[[:space:]]*"proofstream-web"' "$BODY" \
    && grep -Eq '"time"[[:space:]]*:[[:space:]]*"[0-9]{4}-[0-9]{2}-[0-9]{2}T' "$BODY"; then
  report PASS 'health: 200 JSON service status and time, no-store'
else report FAIL "health (HTTP $STATUS)"; fi

if fetch_url "$ORIGIN/definitely-not-a-page" && [[ "$STATUS" == 404 ]] \
    && grep -Eq '<meta[[:space:]]+name="robots"[[:space:]]+content="noindex"' "$BODY"; then
  report PASS 'Unknown path returns branded 404 with noindex'
else report FAIL "Unknown path must be 404, not an app-shell 200 (HTTP $STATUS)"; fi

if fetch_url "$ORIGIN/" POST && [[ "$STATUS" == 405 ]] \
    && header_matches '^allow:[[:space:]]*GET, HEAD[[:space:]]*$'; then
  report PASS 'POST / rejected with 405 and Allow: GET, HEAD'
else report FAIL "POST / method restriction (HTTP $STATUS)"; fi

if fetch_url "$ORIGIN/example-path/?x=1" && [[ "$STATUS" == 301 ]] \
    && header_matches '^location:[[:space:]]*https://proofstreamapp\.com/example-path\?x=1[[:space:]]*$'; then
  report PASS 'Trailing slash redirect preserves query'
else report FAIL "Trailing slash redirect (HTTP $STATUS)"; fi

if fetch_url 'https://proofstream-web.pantheon-platform.workers.dev/' && [[ "$STATUS" != 200 ]]; then
  report PASS "workers.dev is not serving the site (HTTP $STATUS)"
else report FAIL "workers.dev disabled check (HTTP $STATUS; network failures require investigation)"; fi

if [[ "$FAILURES" -eq 0 ]]; then
  printf '\nAll production checks passed.\n'
else
  printf '\n%d check(s) failed. Review before declaring the cutover complete.\n' "$FAILURES"
  exit 1
fi
