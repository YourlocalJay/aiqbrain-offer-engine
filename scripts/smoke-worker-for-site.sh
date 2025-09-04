#!/usr/bin/env bash
set -euo pipefail

# Smoke check for the site to verify Worker JSON + CORS
# Usage:
#   export WBASE="https://aiqbrain-offer-engine.<acct>.workers.dev"
#   npm run smoke:worker:site
# Or: bash scripts/smoke-worker-for-site.sh https://your.worker.workers.dev

BASE="${WBASE:-}"
if [[ -z "${BASE}" && $# -ge 1 ]]; then BASE="$1"; fi
if [[ -z "${BASE}" ]]; then
  echo "WBASE env or first arg (base URL) is required" >&2
  exit 2
fi

URL="${BASE%/}/api/offers?limit=3"

TMP_BODY="$(mktemp)"
HTTP_CODE=$(curl -sS -o "$TMP_BODY" -w "%{http_code}" -H 'Accept: application/json' "$URL" || true)

ids=""
if command -v jq >/dev/null 2>&1; then
  ids=$(jq -r '.[0:2][]?.id // empty' "$TMP_BODY" | paste -sd, - || true)
else
  # Fallback: light grep to find up to two id values
  ids=$(sed -n 's/.*"id"\s*:\s*"\([^"]\+\)".*/\1/p' "$TMP_BODY" | head -n2 | paste -sd, - || true)
fi

# Check a couple of key headers (best-effort)
allow_origin=$(curl -sSI "$URL" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}' | head -n1)
vary_hdr=$(curl -sSI "$URL" | tr -d '\r' | awk -F': ' 'tolower($1)=="vary"{print $2}' | head -n1)

echo "HTTP ${HTTP_CODE} | ids: ${ids:-n/a}"
if [[ -n "$allow_origin" ]]; then echo "Access-Control-Allow-Origin: $allow_origin"; fi
if [[ -n "$vary_hdr" ]]; then echo "Vary: $vary_hdr"; fi

rm -f "$TMP_BODY"

