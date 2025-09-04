# Ops/QA Cheat Sheet — AIQBrain Offer Engine

This one‑pager provides copy‑pasteable checks for health, admin UIs, CORS preflight, and upserts for both your domain and workers.dev.

## Variables (adjust as needed)

```bash
export BASE=https://aiqbrain.com
export WBASE=https://aiqbrain-offer-engine.<your_acct>.workers.dev
export ADMIN_TOKEN=__paste__
export BASIC_AUTH_USER=
export BASIC_AUTH_PASS=
```

## Public Health & Offers (domain)

```bash
# Health
curl -sS "$BASE/health" | jq .

# Offers (first 3)
curl -sS "$BASE/api/offers?limit=3" | jq .

# MyLead sync (POST)
curl -sS -X POST "$BASE/sync/offers/mylead" | jq .
```

## Admin HTML probes (prefer /console, /admintemp)

HEAD is supported, but use GET with header capture to verify content-type:

```bash
for p in /console /admintemp /xadmin /api/admin/ui /admin.txt; do
  echo "$p ->" && curl -sS -o /dev/null -D - "$BASE$p" | grep -i '^content-type';
done
```

If BASIC auth is enabled:

```bash
curl -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASS" -sS -o /dev/null -D - "$BASE/console" | grep -i '^content-type'
```

## CORS preflight (OPTIONS) for admin upserts

```bash
for p in /console/offers /admintemp/offers /xadmin/offers /api/admin/offers; do
  echo "OPTIONS $p ->" && curl -sS -o /dev/null -w "%{http_code}\n" -X OPTIONS \
    -H "Origin: https://aiqbrain.com" \
    -H "Access-Control-Request-Method: PUT" \
    -H "Access-Control-Request-Headers: authorization, content-type" \
    "$BASE$p";
done
```

## Upsert example (PUT)

```bash
curl -sS -X PUT "$BASE/console/offers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"id":"demo1","name":"Demo","url":"https://example.com","network":"Manual","payout":1.23}' | jq .
```

## workers.dev sanity checks

```bash
# HTML content-type via GET header capture
curl -sS -o /dev/null -D - "$WBASE/console" | grep -i '^content-type'

# HEAD now returns 200
curl -I "$WBASE/console"

# Routing debuggers
curl -sS "$WBASE/whoami" | jq .
curl -sS "$WBASE/debug/headers" | jq .
```

## Notes

- Admin UI aliases: /admin, /console, /admintemp, /xadmin, /api/admin/ui, and plain text /admin.txt
- HEAD is supported for admin HTML paths (200 + correct Content-Type, empty body).
- /health lists all public and admin upsert routes for quick visibility.
- Optional Zero Trust: add CF-Access-Client-Id/Secret headers to admin GETs if protected.

## CPAGrip Configuration

wrangler.toml [vars]
- CPAGRIP_USER (public, numeric)
- CPAGRIP_PUBKEY (public)
- CPAGRIP_OFFERS_TTL (optional, seconds)

Secrets
- CPAGRIP_KEY (private) -> `wrangler secret put CPAGRIP_KEY`

Enable network:
- Add "CPAGRIP" to `NETWORKS_ENABLED` (comma sep) or set env.

Manual sync:
- POST `/sync/offers/cpagrip` (Authorization: Bearer `<ADMIN_TOKEN>`)

## Site Integration

- API_BASE: the Worker base URL your site should call (e.g., set `API_BASE` to `$WBASE`).
- Example:

```bash
curl -i "$WBASE/api/offers?limit=5" -H 'Accept: application/json'
```

- CORS: `/api/offers` responds with `Access-Control-Allow-Origin: *`, supports `GET, HEAD, OPTIONS`, and includes `Vary: Accept-Encoding`.
