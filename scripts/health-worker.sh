#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-https://aiqbrain.com}"
ACCT="${ACCT:-}"  # optional: your workers.dev account subdomain
WNAME="aiqbrain-offer-engine"

fail(){ echo "❌ $*"; exit 1; }
pass(){ echo "✅ $*"; }

# workers.dev base (optional if ACCT provided)
WBASE=""
if [[ -n "${ACCT}" ]]; then
  WBASE="https://${WNAME}.${ACCT}.workers.dev"
fi

echo "== Worker Smoke =="

# 1) /health (domain)
curl -fsS "${DOMAIN}/health" | jq .ok >/dev/null 2>&1 && pass "domain /health OK" || fail "domain /health failed"

# 2) /api/offers (domain)
curl -fsS "${DOMAIN}/api/offers?limit=3" | jq '.[0]' >/dev/null 2>&1 && pass "domain /api/offers OK" || fail "domain /api/offers failed"

# 3) /sync/offers/mylead (domain, POST)
# Note: does not fail if token missing; expects JSON with .upserted
curl -fsS -X POST "${DOMAIN}/sync/offers/mylead" | jq .upserted >/dev/null 2>&1 \
  && pass "domain POST /sync/offers/mylead OK" \
  || echo "ℹ️  domain POST /sync/offers/mylead not ready (missing token?)"

# 4) /admin (domain)
curl -fsSI "${DOMAIN}/admin" | grep -qi 'content-type: text/html' && pass "domain /admin serves HTML" || fail "domain /admin not HTML"

# 5) /console (domain)
curl -fsSI "${DOMAIN}/console" | grep -qi 'content-type: text/html' && pass "domain /console serves HTML" || fail "domain /console not HTML"

# 6) /admintemp (domain)
curl -fsSI "${DOMAIN}/admintemp" | grep -qi 'content-type: text/html' \
  && pass "domain /admintemp serves HTML" \
  || fail "domain /admintemp not HTML"

# If BASIC_AUTH is set (user:pass), show example curl
if [[ -n "${BASIC_AUTH:-}" ]]; then
  echo "Example (Basic Auth): curl -I -u \"${BASIC_AUTH}\" ${DOMAIN}/console"
fi

# Optional workers.dev checks if ACCT present
if [[ -n "${WBASE}" ]]; then
  curl -fsS "${WBASE}/health" | jq .ok >/dev/null 2>&1 && pass "workers.dev /health OK" || fail "workers.dev /health failed"
  curl -fsS "${WBASE}/api/offers?limit=1" | jq '.[0]' >/dev/null 2>&1 && pass "workers.dev /api/offers OK" || fail "workers.dev /api/offers failed"
  curl -fsS -X POST "${WBASE}/sync/offers/mylead" | jq .upserted >/dev/null 2>&1 && pass "workers.dev POST /sync/offers/mylead OK" || fail "workers.dev POST /sync failed"
fi

echo "== OK =="
