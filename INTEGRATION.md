# Integration Guide: AIQBrain Offer Engine

## Base URLs
- workers.dev: `https://aiqbrain-offer-engine.jasonhslaughter.workers.dev`
- Spec: `/openapi.json`, `/openapi.yaml`
- Plugin manifest: `/.well-known/ai-plugin.json`

## Auth
- Scheme: user_http → Bearer
- Header: `Authorization: Bearer <API_KEY>` (or `X-Api-Key: <API_KEY>`)
- Rotate/add keys (CSV): `printf 'key1,key2' | npx wrangler secret put AIQ_API_KEYS --name aiqbrain-offer-engine`

## Endpoints
- `GET /offers/health` (plain "ok")
- `GET /offers/health?detail=1` (JSON: status, version, counts, coverage)
- `GET /offers/search` (secured; see parameters)
- Public UI: `GET /vault`, `GET /vault/search`
- Redirects: `GET /sv`, `/sweeps`, `/win500`
- Spec/Plugin: `GET /openapi.json`, `GET /.well-known/ai-plugin.json`

## Query Parameters (search)
- `geo`: CSV of countries; e.g. `US,CA,UK,AU,DE,FR`
- `device`: CSV; `mobile,desktop`
- `ctype`: CSV or `*` (hint match against vertical/id; not hard‑gated)
- `network`: CSV; e.g. `ogads,cpagrip`
- `allowed_traffic`: CSV; `channel` is a single‑value alias
- `max`: integer ≤ 50
- `min_payout`: number
- `split`: boolean; `split_mode`: `traffic|payout` (default `traffic`)
- `friction_max`: integer (GREEN default 7 when `split=true`)
- `allowed_traffic_mode`: `all|any` (default `all`)
- Advanced: `whale_threshold` (number; ≥ threshold filters flat/traffic; groups payout split)

## Responses
- Flat: `{ offers: Offer[] }` with `_score` on each item (sorted desc by score)
- Traffic split: `{ meta, green: Offer[], yellow: Offer[], counts, rules }`
- Payout split: `{ meta, whales: Offer[], minnows: Offer[], counts, rules: { whale_threshold } }`

## Scoring
- Whale (payout ≥ $10): weights payout:0.5, epc:0.2, traffic:0.2, geo:0.05, friction:0.05
- Minnow (< $10): payout:0.2, epc:0.4, traffic:0.2, geo:0.10, friction:0.10
- `normPayout = log1p(payout)`; EPC raw ≥ 0
- `geoMatch`: Tier‑1 EN (US/CA/UK/AU)=1, Tier‑1 EU (DE/FR/IE/NZ)=0.5, else 0
- `frictionBonus`: ≤7 → 1, ≤15 → 0.5, else 0

## GPT Setup
- Builder → Actions → Import from URL: `https://aiqbrain-offer-engine.jasonhslaughter.workers.dev/openapi.json`
- Auth: user_http + Bearer; set token to your API key
- Test: `GET /offers/search?geo=US&device=mobile&ctype=*&max=10`

## CORS
- `Access-Control-Allow-Origin: *` with common headers; GPT Actions call server‑to‑server (no browser CORS issues)

## Examples
- Flat (with _score):
  ```bash
  curl -sS -G -H "Authorization: Bearer <KEY>" \
    'https://aiqbrain-offer-engine.jasonhslaughter.workers.dev/offers/search' \
    --data-urlencode 'geo=US,CA' --data-urlencode 'device=mobile,desktop' \
    --data-urlencode 'ctype=*' --data-urlencode 'max=10' \
    | jq '.offers | length, .[0]'
  ```
- Traffic split (GREEN≤7 default):
  ```bash
  curl -sS -G -H "Authorization: Bearer <KEY>" \
    'https://aiqbrain-offer-engine.jasonhslaughter.workers.dev/offers/search' \
    --data-urlencode 'split=true' --data-urlencode 'split_mode=traffic' \
    | jq '{counts, sample_green: (.green[0]//null)}'
  ```
- Payout split (whales/minnows):
  ```bash
  curl -sS -G -H "Authorization: Bearer <KEY>" \
    'https://aiqbrain-offer-engine.jasonhslaughter.workers.dev/offers/search' \
    --data-urlencode 'split=true' --data-urlencode 'split_mode=payout' \
    --data-urlencode 'whale_threshold=10' \
    | jq '{counts, rules}'
  ```

## Public Vault (no key)
- UI: `https://aiqbrain-offer-engine.jasonhslaughter.workers.dev/vault`
- Split: `.../vault/search?split=true&friction_max=7&max=10` (sortable tables, “Show all”)

## Health / Monitoring
- `GET /offers/health?detail=1` → `{ status, time, info{version}, counts{registry,fallbacks,merged}, coverage{networks,geos,devices} }`

## Notes
- No secrets are embedded; API keys are stored as a Worker secret `AIQ_API_KEYS`.
- To update keys: `printf 'key1,key2' | npx wrangler secret put AIQ_API_KEYS --name aiqbrain-offer-engine`
- This Worker intentionally runs on workers.dev only; no zone routes are configured.
