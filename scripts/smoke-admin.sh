#!/usr/bin/env bash
set -euo pipefail
DOMAIN="${1:-https://aiqbrain.com}"

paths=(
  "/admin"
  "/console"
  "/admintemp"
  "/xadmin"
  "/admin.txt"
  "/api/admin/ui"
)

echo "== Admin UI probes on $DOMAIN =="
for p in "${paths[@]}"; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" -I "$DOMAIN$p" || true)
  ctype=$(curl -sS -I "$DOMAIN$p" 2>/dev/null | tr -d '\r' | awk 'BEGIN{IGNORECASE=1}/^content-type:/{print $2;exit}')
  printf "  %-16s  %-3s  %s\n" "$p" "$code" "${ctype:-"-"}"
done

echo "== Admin PUT preflight/CORS =="
upsert_paths=(
  "/admin/offers"
  "/console/offers"
  "/admintemp/offers"
  "/xadmin/offers"
  "/api/admin/offers"
)
for p in "${upsert_paths[@]}"; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" -X OPTIONS \
    -H "Origin: https://aiqbrain.com" \
    -H "Access-Control-Request-Method: PUT" \
    -H "Access-Control-Request-Headers: authorization, content-type" \
    "$DOMAIN$p" || true)
  printf "  OPTIONS %-18s  %s\n" "$p" "$code"
done
echo "== Done =="

