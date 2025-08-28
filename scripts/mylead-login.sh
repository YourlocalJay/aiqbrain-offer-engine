#!/usr/bin/env bash
set -euo pipefail

# MyLead login helper: exchanges email/password for a Bearer token
# Usage: MYLEAD_BASE='https://api.mylead.global/api/publisher/v1' ./scripts/mylead-login.sh

BASE_DEFAULT='https://api.mylead.global/api/publisher/v1'
BASE="${MYLEAD_BASE:-$BASE_DEFAULT}"

read -r -p "MyLead email: " MYLEAD_EMAIL
read -r -s -p "MyLead password: " MYLEAD_PASSWORD; echo

if [[ -z "$MYLEAD_EMAIL" || -z "$MYLEAD_PASSWORD" ]]; then
  echo "Email or password missing" >&2
  exit 1
fi

LOGIN_URL="${BASE%/}/auth/login"
TOKEN=$(curl -sS -X POST "$LOGIN_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$MYLEAD_EMAIL\",\"password\":\"$MYLEAD_PASSWORD\"}" \
  | jq -r '.access_token // .token // .accessToken // empty')

if [[ -z "$TOKEN" ]]; then
  echo "Failed to obtain token from $LOGIN_URL" >&2
  exit 2
fi

echo "Token (copy into secret MYLEAD_API_KEY):"
echo "$TOKEN"
echo "Token prefix: ${TOKEN:0:12}…"

echo
echo "Example next steps:"
echo "  printf '%s' '$TOKEN' | npx wrangler secret put MYLEAD_API_KEY --name aiqbrain-offer-engine"
echo "  printf '%s' '$BASE'  | npx wrangler secret put MYLEAD_BASE --name aiqbrain-offer-engine"
echo "  printf '%s' 'ogads,cpagrip,mylead' | npx wrangler secret put NETWORKS_ENABLED --name aiqbrain-offer-engine"
