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

# 4) /admin (domain) via GET header capture
curl -fsS -o /dev/null -D - "${DOMAIN}/admin" | grep -qi 'content-type: text/html' \
  && pass "domain /admin serves HTML (GET)" || fail "domain /admin not HTML"

# 5) /console (domain)
curl -fsS -o /dev/null -D - "${DOMAIN}/console" | grep -qi 'content-type: text/html' \
  && pass "domain /console serves HTML (GET)" || fail "domain /console not HTML"

# 6) /admintemp (domain)
curl -fsS -o /dev/null -D - "${DOMAIN}/admintemp" | grep -qi 'content-type: text/html' \
  && pass "domain /admintemp serves HTML (GET)" \
  || fail "domain /admintemp not HTML"

# 7) /console (www optional check)
if [[ "${WWW:-0}" == "1" ]]; then
  curl -fsSI "https://www.${DOMAIN#https://}/console" >/dev/null 2>&1 \
    && pass "www /console reachable (status seen in headers)" \
    || echo "ℹ️  www /console not reachable (route not attached or WAF)"
fi

# If BASIC_AUTH is set (user:pass), show example curl
if [[ -n "${BASIC_AUTH:-}" ]]; then
  echo "Example (Basic Auth): curl -I -u \"${BASIC_AUTH}\" ${DOMAIN}/console"
fi

# Optional workers.dev checks if ACCT present
if [[ -n "${WBASE}" ]]; then
  curl -fsS "${WBASE}/health" | jq .ok >/dev/null 2>&1 && pass "workers.dev /health OK" || fail "workers.dev /health failed"
  curl -fsS "${WBASE}/api/offers?limit=1" | jq '.[0]' >/dev/null 2>&1 && pass "workers.dev /api/offers OK" || fail "workers.dev /api/offers failed"
  curl -fsS -X POST "${WBASE}/sync/offers/mylead" | jq .upserted >/dev/null 2>&1 && pass "workers.dev POST /sync/offers/mylead OK" || fail "workers.dev POST /sync failed"
  curl -fsS -o /dev/null -D - "${WBASE}/console" | grep -qi 'content-type: text/html' && pass "workers.dev /console HTML" || echo "ℹ️  workers.dev /console not HTML"
  curl -fsS -o /dev/null -D - "${WBASE}/api/admin/ui" | grep -qi 'content-type: text/html' && pass "workers.dev /api/admin/ui HTML" || echo "ℹ️  workers.dev /api/admin/ui not HTML"
  curl -fsS -o /dev/null -D - "${WBASE}/admin.txt" | grep -qi 'content-type: text/plain' && pass "workers.dev /admin.txt text/plain" || echo "ℹ️  workers.dev /admin.txt not text/plain"

  # workers.dev CPAGrip sync (informational)
  curl -fsS -X POST "${WBASE}/sync/offers/cpagrip" -H "Authorization: Bearer ${ADMIN_TOKEN:-}" \
    | jq .upserted >/dev/null 2>&1 && pass "workers.dev POST /sync/offers/cpagrip OK" \
    || echo "ℹ️  workers.dev /sync/offers/cpagrip not available"
fi

echo "== OK =="
