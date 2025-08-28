## AIQBrain Offer Engine

Cloudflare Worker that searches curated CPA/CPI offers and serves an OpenAPI spec and AI plugin manifest.

- Worker (TypeScript): `src/worker.ts`
- OpenAPI endpoints: `/openapi.json`, `/openapi.yaml`
- Health: `/offers/health`
- Search: `/offers/search` (requires `X-Api-Key`)
- Curated registry: `registry.json` (merged over built-in fallbacks)

### Quick Start (local)

1) Install deps (types only):
   - `npm i`

2) Dev server:
   - `npx wrangler dev --local`

3) Smoke tests (in another terminal):
   - Health:
     - `curl -sS http://127.0.0.1:8787/offers/health`
   - Search (flat list):
     - `curl -sS -G -H "X-Api-Key: aiq_dev_test_key_001" http://127.0.0.1:8787/offers/search --data-urlencode 'geo=US' --data-urlencode 'device=mobile' --data-urlencode 'ctype=*' --data-urlencode 'max=10' | jq .`
   - Split view (GREEN defaults to friction_minutes <= 7):
     - `curl -sS -G -H "X-Api-Key: aiq_dev_test_key_001" http://127.0.0.1:8787/offers/search --data-urlencode 'geo=US' --data-urlencode 'device=mobile' --data-urlencode 'ctype=*' --data-urlencode 'split=true' | jq '{counts, sample_green: (.green[0]//null), sample_yellow: (.yellow[0]//null)}'`
   - OpenAPI version:
     - `curl -sS http://127.0.0.1:8787/openapi.json | jq .openapi`

### Broader Search & Splits

- Broader CSV search and higher payouts:
  - `curl -sS -G -H "X-Api-Key: $AIQB_KEY" "$BASE/offers/search" \
    --data-urlencode 'geo=US,CA,UK,AU,DE,FR' \
    --data-urlencode 'device=mobile,desktop' \
    --data-urlencode 'ctype=CPA,CPI,CC-submit,SOI,DOI,Trial,Deposit' \
    --data-urlencode 'network=ogads,cpagrip,maxbounty,clickdealer,adcombo,everad,incomeaccess,algoaffiliates,globalwidemedia' \
    --data-urlencode 'min_payout=10' \
    --data-urlencode 'allowed_traffic=Facebook,Google,Native,Email,Push,Reddit,TikTok,Pinterest' \
    --data-urlencode 'max=50' | jq '.offers | length'`

- Split modes:
  - Traffic (GREEN/YELLOW; GREEN<=7 by default):
    - `curl -sS -G -H "X-Api-Key: $AIQB_KEY" "$BASE/offers/search" --data-urlencode 'split=true' --data-urlencode 'split_mode=traffic' | jq '{counts, sample_green: (.green[0]//null), sample_yellow: (.yellow[0]//null)}'`
  - Payout (WHALES/MINNOWS; threshold $10):
    - `curl -sS -G -H "X-Api-Key: $AIQB_KEY" "$BASE/offers/search" --data-urlencode 'split=true' --data-urlencode 'split_mode=payout' | jq '{counts, whales0: (.whales[0]//null), minnows0: (.minnows[0]//null)}'`

### Notes

- The AI plugin manifest is served from the Worker at `/.well-known/ai-plugin.json` (auth: user_http bearer). The static copy in `public/.well-known` has been removed to keep one source of truth.
- `wrangler.toml` uses a single `workers_dev = true` and includes asset binding for `public/`.
- Keep secrets in Wrangler (`wrangler secret put ...`); dev defaults are non-sensitive.
