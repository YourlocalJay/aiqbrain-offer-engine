#!/usr/bin/env bash
set -euo pipefail

# One-shot QA for aiqbrain-offer-engine
#
# Ready-to-run:
#   export WBASE="https://aiqbrain-offer-engine.<acct>.workers.dev"
#   export DOMAIN="https://aiqbrain.com"          # optional
#   export ADMIN_TOKEN="…"                         # required for admin sync/upsert
#   export LIMIT=10                                 # optional
#   pnpm qa
#   # Report: docs/qa-report.md

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$ROOT_DIR/tmp"
mkdir -p "$TMP_DIR"
LOG_FILE="$TMP_DIR/qa.log"
SUMMARY_FILE="$TMP_DIR/qa-summary.json"
OFFERS_FILE="$TMP_DIR/offers.json"

pass(){ echo "✅ $*" | tee -a "$LOG_FILE"; }
fail(){ echo "❌ $*" | tee -a "$LOG_FILE"; exit 1; }
warn(){ echo "⚠️  $*" | tee -a "$LOG_FILE"; }
info(){ echo "ℹ️  $*" | tee -a "$LOG_FILE"; }

redact(){
  local s="$1"
  if [[ "$s" =~ (TOKEN|KEY|PASS|SECRET) ]]; then
    echo "[redacted]"
  else
    echo "$2"
  fi
}

# Env
WBASE="${WBASE:-}"
DOMAIN="${DOMAIN:-}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
LIMIT="${LIMIT:-10}"

[[ -n "$WBASE" ]] || fail "WBASE is required (https://<worker>.<acct>.workers.dev)"

# Derive ACCT for scripts/health-worker.sh workers.dev section
if [[ -z "${ACCT:-}" ]]; then
  if [[ "$WBASE" =~ ^https?://[^.]+\.([^.]+)\.workers\.dev/?$ ]]; then
    export ACCT="${BASH_REMATCH[1]}"
  fi
fi

# 1) Echo environment (redacted)
{
  echo "== Environment =="
  echo "WBASE: $WBASE"
  echo "DOMAIN: ${DOMAIN:-<unset>}"
  echo "ADMIN_TOKEN: [redacted]"
  echo "LIMIT: $LIMIT"
} | tee -a "$LOG_FILE"

# 2) Health
if [[ -n "$DOMAIN" ]]; then
  bash "$SCRIPT_DIR/health-worker.sh" "$DOMAIN" || fail "domain health failed"
else
  info "DOMAIN not set — skipping domain checks"
fi
bash "$SCRIPT_DIR/health-worker.sh" || warn "workers.dev health script finished with warnings"

# 3) Sync networks (admin)
SYNC_RES_CPAGRIP="$TMP_DIR/sync_cpagrip.json"
SYNC_RES_MYLEAD="$TMP_DIR/sync_mylead.json"

if [[ -n "$ADMIN_TOKEN" ]]; then
  curl -fsS -X POST "$WBASE/sync/offers/cpagrip" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H 'Accept: application/json' \
    -o "$SYNC_RES_CPAGRIP" \
    && pass "POST /sync/offers/cpagrip" || warn "cpagrip sync not available"
else
  warn "ADMIN_TOKEN not set — skipping /sync/offers/cpagrip"
fi

# /sync/offers/mylead does not require admin in this worker; include Bearer if present
curl -fsS -X POST "$WBASE/sync/offers/mylead" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Accept: application/json' \
  -o "$SYNC_RES_MYLEAD" \
  && pass "POST /sync/offers/mylead" || warn "mylead sync not available"

info "MaxBounty/OGAds sync routes not implemented — skipping"

# 4) Public offers probe
curl -fsS "$WBASE/api/offers?limit=$LIMIT" -H 'Accept: application/json' -o "$OFFERS_FILE" \
  && pass "GET /api/offers saved to tmp/offers.json" || fail "/api/offers unreachable"

source "$SCRIPT_DIR/json-tools.sh"
total_count=0
if has_jq; then total_count=$(jq 'length' "$OFFERS_FILE"); else total_count=$(wc -l < "$OFFERS_FILE" || echo 0); fi
[[ "$total_count" -ge 1 ]] && pass "offers returned ($total_count)" || warn "no offers returned"

count_cp=$(count_network "$OFFERS_FILE" "CPAGrip" || echo 0)
count_ml=$(count_network "$OFFERS_FILE" "MyLead" || echo 0)
count_mb=$(count_network "$OFFERS_FILE" "MaxBounty" || echo 0)
count_og=$(count_network "$OFFERS_FILE" "OGAds" || echo 0)

[[ "$count_cp" -gt 0 ]] || warn "CPAGrip count 0"
[[ "$count_ml" -gt 0 ]] || warn "MyLead count 0"
[[ "$count_mb" -gt 0 ]] || info "MaxBounty count 0 (may be expected)"
[[ "$count_og" -gt 0 ]] || info "OGAds count 0 (may be expected)"

# 5) Filtering sanity checks (best-effort on /api/offers, non-fatal)
FILTER_NET_FILE="$TMP_DIR/offers_net_cp.json"
curl -fsS "$WBASE/api/offers?limit=5&network=CPAGrip" -H 'Accept: application/json' -o "$FILTER_NET_FILE" || true
if assert_network_only "$FILTER_NET_FILE" "CPAGrip"; then
  pass "network filter (CPAGrip) looks consistent"
else
  warn "network filter check inconclusive/failed (API may not filter on /api/offers)"
fi

FILTER_GEO_FILE="$TMP_DIR/offers_geo_us.json"
curl -fsS "$WBASE/api/offers?limit=5&geo=US" -H 'Accept: application/json' -o "$FILTER_GEO_FILE" || true
if assert_geo_contains "$FILTER_GEO_FILE" "US"; then
  pass "geo filter (US) looks consistent"
else
  warn "geo filter check inconclusive/failed (API may not filter on /api/offers)"
fi

# 6) Admin upsert & CORS
allow_methods=$(curl -fsSI -X OPTIONS "$WBASE/admin/offers" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-methods"{print tolower($2)}' || true)
if echo "$allow_methods" | grep -q 'put'; then pass "CORS preflight allows PUT"; else warn "CORS preflight missing PUT"; fi

HTTP_OK=$(curl -fsS -o /dev/null -w "%{http_code}" -X PUT "$WBASE/admin/offers" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data '[]' || echo "")
[[ "$HTTP_OK" == "200" ]] && pass "PUT /admin/offers with empty array (200)" || warn "PUT /admin/offers empty array not 200 ($HTTP_OK)"

HTTP_401=$(curl -sS -o "$TMP_DIR/upsert_unauth.json" -w "%{http_code}" -X PUT "$WBASE/admin/offers" \
  -H 'Content-Type: application/json' \
  --data '{"id":"x","name":"x","url":"https://example.com","network":"Manual"}' || echo "")
if [[ "$HTTP_401" == "401" ]]; then
  pass "PUT /admin/offers without Bearer → 401"
else
  warn "PUT /admin/offers without Bearer expected 401, got $HTTP_401"
fi

DEMO_ID="qa_demo_codex_1"
curl -fsS -X PUT "$WBASE/admin/offers" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data "{\"id\":\"$DEMO_ID\",\"name\":\"QA Demo\",\"url\":\"https://example.org\",\"network\":\"Manual\",\"payout\":0.01}" \
  >/dev/null && pass "PUT /admin/offers demo upsert"

sleep 1
if curl -fsS "$WBASE/api/offers?limit=100" | grep -q "$DEMO_ID"; then
  pass "demo offer present in /api/offers"
else
  warn "demo offer not found in /api/offers"
fi

# 7) HTML endpoints
declare -a HTML_PATHS=(/admin /console /admintemp /xadmin)
for p in "${HTML_PATHS[@]}"; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$WBASE$p" || echo "")
  ctype=$(curl -sS -o /dev/null -D - "$WBASE$p" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print tolower($2)}' | head -n1)
  if [[ "$code" == "200" && "$ctype" =~ text/html ]]; then
    pass "$p HTML (200)"
  elif [[ "$code" == "301" || "$code" == "302" ]]; then
    info "$p redirect ($code)"
  elif [[ "$code" == "403" ]]; then
    info "$p forbidden (WAF/Zero-Trust)"
  else
    warn "$p unexpected ($code)"
  fi
done

# 8) Whoami/headers (best-effort)
for dbg in /whoami /debug/headers; do
  if curl -fsS "$WBASE$dbg" >/dev/null 2>&1; then
    pass "$dbg available"
  else
    info "$dbg not present"
  fi
done

# 9) Unit tests
TEST_OUT="$TMP_DIR/test.out"
if pnpm -s test >"$TEST_OUT" 2>&1; then
  pass "unit tests passed"
else
  warn "unit tests had issues (see $TEST_OUT)"
fi

# 10) Summary (machine-readable)
cat > "$SUMMARY_FILE" <<JSON
{
  "env": {
    "WBASE": "${WBASE}",
    "DOMAIN": "${DOMAIN}",
    "LIMIT": ${LIMIT}
  },
  "sync": {
    "cpagrip": $(cat "$SYNC_RES_CPAGRIP" 2>/dev/null || echo '{"message":"n/a"}'),
    "mylead": $(cat "$SYNC_RES_MYLEAD" 2>/dev/null || echo '{"message":"n/a"}')
  },
  "offers": {
    "total": ${total_count},
    "counts": { "CPAGrip": ${count_cp:-0}, "MyLead": ${count_ml:-0}, "MaxBounty": ${count_mb:-0}, "OGAds": ${count_og:-0} }
  }
}
JSON

pass "Wrote summary: $SUMMARY_FILE"

# Compact table
echo "\n== Coverage (offers by network) ==" | tee -a "$LOG_FILE"
printf "%-12s %6s\n" "Network" "Count" | tee -a "$LOG_FILE"
printf "%-12s %6s\n" "CPAGrip" "$count_cp" | tee -a "$LOG_FILE"
printf "%-12s %6s\n" "MyLead" "$count_ml" | tee -a "$LOG_FILE"
printf "%-12s %6s\n" "MaxBounty" "$count_mb" | tee -a "$LOG_FILE"
printf "%-12s %6s\n" "OGAds" "$count_og" | tee -a "$LOG_FILE"

exit 0

