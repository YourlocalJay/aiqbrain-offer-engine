#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:8787}"
KEY="${AIQB_KEY:-aiq_dev_test_key_001}"

have() { command -v "$1" >/dev/null 2>&1; }
JQ() { if have jq; then jq "$@"; else cat; fi; }

section() { echo; echo "==> $*"; }

fail=0

section "Health (plain + detail JSON)"
curl -fsS "$BASE/offers/health" | sed -n '1,1p' || { echo "health plain failed"; fail=1; }
curl -fsS -H 'Accept: application/json' "$BASE/offers/health" | JQ -r '.status' || { echo "health json failed"; fail=1; }
curl -fsS "$BASE/offers/health?detail=1" | JQ '{status, info, counts, coverage}' || { echo "health detail failed"; fail=1; }

section "Unauthorized search (should be 401)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/offers/search?geo=US&device=mobile&ctype=*" )
echo "status=$code"; [[ "$code" == 401 ]] || { echo "expected 401"; fail=1; }

section "Flat search + _score present"
curl -fsS -G -H "X-Api-Key: $KEY" "$BASE/offers/search" \
  --data-urlencode 'geo=US,CA' --data-urlencode 'device=mobile,desktop' --data-urlencode 'ctype=*' --data-urlencode 'max=10' \
  | JQ '.offers | {len:length, sample: (.[0]|{id,network,payout,_score})}'

section "Traffic split (default friction=7)"
curl -fsS -G -H "X-Api-Key: $KEY" "$BASE/offers/search" \
  --data-urlencode 'split=true' --data-urlencode 'split_mode=traffic' \
  | JQ '{counts, rules}'

section "Payout split (threshold=2)"
curl -fsS -G -H "X-Api-Key: $KEY" "$BASE/offers/search" \
  --data-urlencode 'split=true' --data-urlencode 'split_mode=payout' --data-urlencode 'whale_threshold=2' \
  | JQ '{counts, rules}'

section "Traffic split with whale filter (threshold=2)"
curl -fsS -G -H "X-Api-Key: $KEY" "$BASE/offers/search" \
  --data-urlencode 'split=true' --data-urlencode 'split_mode=traffic' --data-urlencode 'whale_threshold=2' \
  | JQ '{counts, rules}'

section "OpenAPI sanity (version + param count)"
curl -fsS "$BASE/openapi.json" | JQ -r '.openapi, (.paths["/offers/search"].get.parameters|length)'

echo; echo "Advanced health checks completed with fail=$fail"
exit "$fail"

