#!/usr/bin/env bash
# Tiny jq helpers with graceful fallback
set -euo pipefail

has_jq(){ command -v jq >/dev/null 2>&1; }

redact_kv(){
  # usage: redact_kv KEY VALUE
  local k="$1" v="${2:-}"
  if [[ "$k" =~ (TOKEN|KEY|PASS|SECRET) ]]; then
    printf '[redacted]'
  else
    printf '%s' "$v"
  fi
}

count_network(){
  # usage: count_network FILE NETWORK_NAME
  local f="$1" name="$2"
  if has_jq; then
    jq -r --arg n "$name" '[.[] | select((.network//"")|ascii_downcase == ($n|ascii_downcase))] | length' "$f"
  else
    echo "hint: install jq for accurate counts" >&2
    # naive fallback
    tr '[:upper:]' '[:lower:]' < "$f" | grep -o '"network"\s*:\s*"[^"]\+"' | grep -ci "$name" || true
  fi
}

assert_network_only(){
  # usage: assert_network_only FILE NETWORK_NAME
  local f="$1" name="$2"
  if has_jq; then
    local other
    other=$(jq -r --arg n "$name" '[.[] | select((.network//"")|ascii_downcase != ($n|ascii_downcase))] | length' "$f")
    [[ "$other" == "0" ]]
  else
    echo "hint: install jq for accurate assertions" >&2
    return 2
  fi
}

assert_geo_contains(){
  # usage: assert_geo_contains FILE GEO_CODE
  local f="$1" code="$2"
  if has_jq; then
    local bad
    bad=$(jq -r --arg c "$code" '[.[] | select(((.geo//[])|join(",")|ascii_upcase|contains($c|ascii_upcase))|not)] | length' "$f")
    [[ "$bad" == "0" ]]
  else
    echo "hint: install jq for accurate assertions" >&2
    return 2
  fi
}

