## AIQBrain Offer Engine

Cloudflare Worker that searches curated CPA/CPI offers and serves an OpenAPI spec and AI plugin manifest.

- Worker (TypeScript): `src/worker.ts`
- OpenAPI endpoints: `/openapi.json`, `/openapi.yaml`
- Health: `/offers/health`
- Search: `/offers/search` (requires `X-Api-Key`)
- Public Vault: `/vault` (HTML), `/vault/search` (HTML; supports split=true)
- Curated registry: `registry.json` (merged over built-in fallbacks)

### MyLead Token (Username/Password Flow)

MyLead external API tokens expire every few hours. Configure username/password and the worker will auto-login and cache a Bearer token in KV.

- Secrets (Wrangler):
  - `MYLEAD_USERNAME` — your MyLead username or email
  - `MYLEAD_PASSWORD` — your MyLead password
  - Optional `MYLEAD_BASE` — e.g. `https://api.mylead.eu/api/external/v1/` (default)
  - Optional `MYLEAD_API_BASE` — alternative base (e.g. `https://mylead.global`)
  - Optional `MYLEAD_OFFERS_PATH` — explicit offers path (e.g. `/api/v2/offers`)
  - Optional `MYLEAD_TOKEN_TTL` — seconds to cache token (default 10800)

- Enable network:
  - In `wrangler.toml` `[vars]`, include `mylead` in `NETWORKS_ENABLED`.

- Admin refresh endpoints (require API key auth):
  - Refresh token: `POST /offers/admin/auth/mylead/refresh-token` → `{ status, token_prefix }`
  - Refresh offers cache: `POST /offers/admin/refresh/mylead?max=100` → `202 Accepted`

- Notes:
  - The worker tries `/auth/login` then `/login` at `MYLEAD_BASE` with `{username,password}` and falls back to `{email,password}`.
  - If `MYLEAD_API_KEY` is set as a secret, it is used directly and login is skipped.

### MyLead Fast Path (Bearer Token Secret)

If your panel issues a token via `POST <MYLEAD_BASE>/auth/token`:

- Secrets (Wrangler):
  - `MYLEAD_BASE` — e.g. `https://<panel>.mylead.io/api/external/v1`
  - `MYLEAD_API_KEY` — paste the token from the auth call

- Usage:
  - The worker sends `Authorization: Bearer <MYLEAD_API_KEY>` to `${MYLEAD_BASE}/offers` (or set `MYLEAD_OFFERS_PATH=/campaigns`).
  - You can force refresh the in-memory cache via: `POST /offers/admin/refresh/mylead` (requires API key auth).

### MaxBounty Token (Email/Password Flow)

MaxBounty issues a short‑lived token (expires ~2h) via email+password. The worker logs in and caches the token in memory and KV; it refreshes early and retries once on 401.

- Secrets (Wrangler):
  - `MAXBOUNTY_EMAIL` — your MaxBounty login email
  - `MAXBOUNTY_PASSWORD` — your MaxBounty password
  - Optional `MAXBOUNTY_BASE` — default `https://affiliates.maxbounty.com`
  - Optional `MAXBOUNTY_TOKEN_TTL` — seconds to cache token (default 6000 ≈100m)
  - Optional `MAXBOUNTY_OFFERS_PATH` — offers endpoint path (default `/offers`)

- Admin refresh endpoints (require API key auth):
  - Refresh token: `POST /offers/admin/auth/maxbounty/refresh-token`
  - Refresh offers cache: `POST /offers/admin/refresh/maxbounty?max=100`

- Use in search:
  - Ensure `NETWORKS_ENABLED` includes `maxbounty`.
  - Query: `GET /offers/search?...&network=maxbounty`

### CPAGrip Private Feed

Fetches from CPAGrip's private JSON feed when credentials are set; results are cached in KV and merged into search results.

- Secrets (Wrangler):
  - `CPAGRIP_USER_ID` — your CPAGrip user/publisher ID
  - `CPAGRIP_SECRET_KEY` — your private API key
  - Optional `CPAGRIP_BASE` — default `https://www.cpagrip.com/common/offer_feed_json.php`

- Admin refresh (requires API auth):
  - `POST /offers/admin/refresh/cpagrip?max=100`

- Enable network: add `cpagrip` in `NETWORKS_ENABLED`.

### OGAds (UnlockContent) API

Pulls live offers from OGAds via the UnlockContent API using a Bearer token.

- Secrets (Wrangler):
  - `OGADS_API_KEY` — your OGAds API token
  - Optional `OGADS_BASE` — default `https://unlockcontent.net/api/v2`
  - Optional `OGADS_OFFERS_PATH` — default `/offers`

- Admin refresh (requires API auth):
  - `POST /offers/admin/refresh/ogads?max=100`

- Enable network: include `ogads` in `NETWORKS_ENABLED`.

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
   - Vault (public):
     - Open: http://127.0.0.1:8787/vault
     - Split view: http://127.0.0.1:8787/vault/search?split=true&friction_max=7&max=10

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
    - `curl -sS -G -H \"X-Api-Key: $AIQB_KEY\" \"$BASE/offers/search\" --data-urlencode 'split=true' --data-urlencode 'split_mode=payout' | jq '{counts, whales0: (.whales[0]//null), minnows0: (.minnows[0]//null)}'`
    - Adjust threshold, e.g. whales at $5: add `--data-urlencode 'whale_threshold=5'`

### Parameters and Tips

- `geo`: CSV of ISO country codes, e.g. `US,CA,UK,AU,DE,FR`.
- `device`: CSV of `mobile` and/or `desktop`.
- `ctype`: CSV tokens or `*` to disable. Common tokens include `CPA`, `CPI`, `SOI`, `DOI`, `Trial`, `Deposit`, and vertical hints like `finance`, `casino`, `nutra`.
- `network`: CSV of network slugs, e.g. `ogads,cpagrip,...`.
- `allowed_traffic`: CSV; `channel` is a single-value alias and auto-deduped into `allowed_traffic`.
- `min_payout`: Filters out lower payouts. Whales/minnows split uses $10 threshold.
- `split_mode`:
  - `traffic` (default): GREEN/YELLOW by `allowed_traffic` and `friction_max` (default 7 when split=true).
  - `payout`: WHALES (payout >= $10) vs MINNOWS (< $10), both ranked by `_score`.

### Advanced Tuning

- Whale threshold:
  - Flat and traffic split can filter to offers with payout >= threshold when provided.
  - Payout split uses the same threshold to group whales/minnows.
  - Example: `curl -sS -G -H "X-Api-Key: $AIQB_KEY" "$BASE/offers/search" --data-urlencode 'ctype=*' --data-urlencode 'whale_threshold=5' | jq '.offers | length'`

- Traffic mode logic:
  - `allowed_traffic_mode=all|any` controls whether all requested channels must be allowed (default all) or any one is sufficient.
  - Example (allow any): `--data-urlencode 'allowed_traffic=Reddit,TikTok' --data-urlencode 'allowed_traffic_mode=any'`

- Friction threshold:
  - When `split=true` and `split_mode=traffic`, GREEN tier uses `friction_max` (default 7).
  - Example (stricter): `--data-urlencode 'split=true' --data-urlencode 'split_mode=traffic' --data-urlencode 'friction_max=5'`

### Notes

- The AI plugin manifest is served from the Worker at `/.well-known/ai-plugin.json` (auth: user_http bearer). The static copy in `public/.well-known` has been removed to keep one source of truth.
- `wrangler.toml` uses a single `workers_dev = true` and includes asset binding for `public/`.
- Keep secrets in Wrangler (`wrangler secret put ...`); dev defaults are non-sensitive.
 - For GPT Actions and API consumer details, see `INTEGRATION.md`.
## Admin Workarounds

Cloudflare’s free plan may present managed challenges on `/admin*`. This Worker supports non-destructive alternatives you can route to the same Worker:

- Alternate paths (no code changes needed in clients):
  - `/console*` → Admin UI and upsert endpoint
  - `/admintemp*` → Admin UI and upsert endpoint
- Dedicated subdomain: point `admin.aiqbrain.com/*` to this Worker for cleaner separation.
- workers.dev: use `https://aiqbrain-offer-engine.<acct>.workers.dev/console` for out-of-band access.
- Optional Basic Auth (HTML only): set `BASIC_AUTH` secret as `user:pass` to require Basic auth on the admin HTML aliases (`/console*`, `/admintemp*`). Bearer `ADMIN_TOKEN` remains required for PUT upserts.

Zero Trust Access (optional, recommended):
- Map an Access self-hosted app to `/console*` or `/admintemp*` (avoid `/admin*`).
- Session duration: ~24h. Identity provider: One-time PIN is a simple start.
- Keep Browser Integrity Check ON; Access gates after that.

Routes to configure in Cloudflare → Workers & Pages → Domains & Routes:
- `aiqbrain.com/console*` → aiqbrain-offer-engine
- `aiqbrain.com/admintemp*` → aiqbrain-offer-engine
- (Optional) `admin.aiqbrain.com/*` → aiqbrain-offer-engine
- Keep existing API routes (e.g., `/health`, `/api/*`, `/sync/*`, `/postback`) as-is.
