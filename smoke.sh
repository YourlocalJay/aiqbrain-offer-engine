#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:8787}"
KEY="${AIQB_KEY:-aiq_dev_test_key_001}"

have_jq() { command -v jq >/dev/null 2>&1; }

echo "==> 1) Health"
curl -sS "$BASE/offers/health" || true

echo; echo "==> 2) Search (flat)"
if have_jq; then
  curl -sS -G -H "X-Api-Key: $KEY" "$BASE/offers/search" \
    --data-urlencode 'geo=US' \
    --data-urlencode 'device=mobile' \
    --data-urlencode 'ctype=*' \
    --data-urlencode 'max=10' \
    | jq '.offers | length, .[0]'
else
  curl -sS -G -H "X-Api-Key: $KEY" "$BASE/offers/search" \
    --data-urlencode 'geo=US' --data-urlencode 'device=mobile' --data-urlencode 'ctype=*' --data-urlencode 'max=10'
fi

echo; echo "==> 3) Search (split; GREEN<=7 by default)"
if have_jq; then
  curl -sS -G -H "X-Api-Key: $KEY" "$BASE/offers/search" \
    --data-urlencode 'geo=US' \
    --data-urlencode 'device=mobile' \
    --data-urlencode 'ctype=*' \
    --data-urlencode 'split=true' \
    | jq '{counts, sample_green: (.green[0]//null), sample_yellow: (.yellow[0]//null)}'
else
  curl -sS -G -H "X-Api-Key: $KEY" "$BASE/offers/search" \
    --data-urlencode 'geo=US' --data-urlencode 'device=mobile' --data-urlencode 'ctype=*' --data-urlencode 'split=true'
fi

echo; echo "==> 4) OpenAPI (version, param count)"
if have_jq; then
  curl -sS "$BASE/openapi.json" | jq -r '.openapi, .paths["/offers/search"].get.parameters | length'
else
  curl -sS "$BASE/openapi.json" | sed -n '1,80p'
fi

echo; echo "Done."
