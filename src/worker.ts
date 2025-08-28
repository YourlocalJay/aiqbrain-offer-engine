/// <reference lib="webworker" />
/**
 * Type shims so this file compiles even if '@cloudflare/workers-types' is not installed.
 * If you later add the real types, you can remove these and add:
 *   /// <reference types="@cloudflare/workers-types" />
 */
type ExecutionCtx = {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
};
type KVNamespace = {
  get(key: string, options?: any): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number } & Record<string, any>): Promise<void>;
  delete?(key: string): Promise<void>;
};
type ExportedHandlerShim<E = Env> = {
  fetch(request: Request, env: E, ctx: ExecutionCtx): Promise<Response>;
};
// src/worker.ts
export interface Env {
  AIQ_API_KEYS?: string; // comma-separated list, e.g. "aiq_dev_test_key_001,another_key"
  // KV namespaces
  REGISTRY?: KVNamespace;
  LOGS?: KVNamespace;
  // Network toggles and secrets (optional)
  NETWORKS_ENABLED?: string; // csv like "ogads,cpagrip,maxbounty,mylead"
  MAXBOUNTY_API_KEY?: string;
  MAXBOUNTY_EMAIL?: string;    // email for MaxBounty auth
  MAXBOUNTY_PASSWORD?: string; // password for MaxBounty auth
  MAXBOUNTY_TOKEN_TTL?: string; // seconds to cache token in KV/memory (default ~100m)
  MAXBOUNTY_BASE?: string; // optional base URL, defaults to https://affiliates.maxbounty.com
  MAXBOUNTY_OFFERS_PATH?: string; // optional offers path, e.g. /offers or /affiliate/offers
  MYLEAD_API_KEY?: string; // Bearer token (optional; if absent, username/password flow can be used)
  MYLEAD_USERNAME?: string; // username or email for login-based token flow
  MYLEAD_PASSWORD?: string; // password for login-based token flow
  MYLEAD_BASE?: string; // optional override base URL (legacy)
  MYLEAD_API_BASE?: string; // optional override base URL (preferred)
  MYLEAD_OFFERS_PATH?: string; // optional offers path (e.g., /api/v2/offers)
  OFFERS_CACHE_TTL?: string; // ttl in seconds for upstream cache
  // Non-secret vars from wrangler.toml [vars]
  BASE_URL?: string;
  GREEN_MAX_MINUTES?: string;
  FALLBACK_GENERIC?: string;
  MYLEAD_TOKEN_TTL?: string; // seconds to cache login token in KV (default ~3h)
  // CPAGrip private feed
  CPAGRIP_USER_ID?: string;
  CPAGRIP_SECRET_KEY?: string;
  CPAGRIP_PUBLISHER_ID?: string;
  CPAGRIP_BASE?: string;
  // OGAds (UnlockContent) Bearer API
  OGADS_API_KEY?: string; // Bearer token
  OGADS_BASE?: string; // default https://unlockcontent.net/api/v2
  OGADS_OFFERS_PATH?: string; // e.g., /offers
}

type Offer = {
  id: string;
  name: string;
  url: string;
  network: string;
  payout: number;
  epc: number | null;
  geo: string[];
  device: string[];
  vertical: string;
  allowed_traffic: string[];
  friction_minutes: number;
  notes?: string;
  _score?: number;
  tier?: "green" | "yellow";
};

const FALLBACK_OFFERS: Offer[] = [
  {
    id: "ogads_us_android_68831",
    name: "US Android — $750 Gift Card (OGAds)",
    url: "https://singingfiles.com/show.php?l=0&u=2427730&id=68831&tracking_id=",
    network: "OGAds",
    payout: 2.1,
    epc: null,
    geo: ["US"],
    device: ["mobile"],
    vertical: "sweeps",
    allowed_traffic: ["Reddit","TikTok","Pinterest"],
    friction_minutes: 5,
    notes: "Android-first US gift-card path; fast flow",
    _score: 15.1
  },
  {
    id: "ogads_us_ios_69234",
    name: "US iOS — $750 Gift Card (OGAds)",
    url: "https://singingfiles.com/show.php?l=0&u=2427730&id=69234&tracking_id=",
    network: "OGAds",
    payout: 2.1,
    epc: null,
    geo: ["US"],
    device: ["mobile"],
    vertical: "sweeps",
    allowed_traffic: ["Reddit","TikTok","Pinterest"],
    friction_minutes: 5,
    notes: "iOS-optimized US gift-card path",
    _score: 15.1
  },
  {
    id: "cpagrip_us_giftcard_a1",
    name: "US Gift Card — Mobile (CPAGrip)",
    url: "https://aiqbrain-offer-engine.jasonhslaughter.workers.dev/offers/redirect?offer_id=cpagrip_us_giftcard_a1&tracking_id=",
    network: "CPAGrip",
    payout: 1.8,
    epc: null,
    geo: ["US"],
    device: ["mobile"],
    vertical: "sweeps",
    allowed_traffic: ["Reddit","Pinterest"],
    friction_minutes: 6,
    notes: "Short flow; good weekend volume",
    _score: 13.8
  }
];

// Load curated registry and merge over FALLBACK_OFFERS for searches
// Note: requires tsconfig resolveJsonModule enabled.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - JSON import type inferred at runtime by bundler
import REGISTRY from "../registry.json";
type RegOffer = Partial<Offer> & { id: string; name: string; url: string; network: string };

function normalize(list?: string[]) {
  return (list ?? []).map(s => s.trim().toLowerCase());
}

function csv(param: string | null): string[] {
  return (param || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

function anyMatch(hay: string[], needles: string[]): boolean {
  if (!needles.length) return true;
  const set = new Set(hay);
  return needles.some(n => set.has(n));
}

function logNorm(x: number, max = 200): number {
  const v = Math.max(0, x);
  return Math.log1p(v) / Math.log1p(max);
}

// Scoring helpers (Offer Vault + Broader Feed)
const TIER1_EN = new Set(["US","CA","UK","AU"]);
const TIER1_EU = new Set(["DE","FR","IE","NZ"]);

function normPayout(x?: number) { return Math.log1p(Math.max(0, x ?? 0)); }
function frictionBonus(mins?: number) {
  const m = mins ?? 999;
  if (m <= 7) return 1;
  if (m <= 15) return 0.5;
  return 0;
}
function geoMatch(geoList: string[] = []) {
  const up = geoList.map(g => g.toUpperCase());
  if (up.some(g => TIER1_EN.has(g))) return 1;
  if (up.some(g => TIER1_EU.has(g))) return 0.5;
  return 0;
}
function trafficMatch(allowed: string[] = [], requested: string[] = [], mode: "all"|"any" = "all") {
  const A = new Set(allowed.map(s => s.toLowerCase()));
  const R = requested.map(s => s.toLowerCase());
  if (!R.length) return 1; // neutral if nothing requested
  if (mode === "all") return R.every(r => A.has(r)) ? 1 : 0;
  return R.some(r => A.has(r)) ? 1 : 0;
}
function scoreOffer(o: Offer, opts: { allowed: string[]; whaleThreshold?: number; allowedMode?: "all"|"any" }): number {
  const payout = normPayout(o.payout);
  const epc = Math.max(0, o.epc ?? 0); // use raw EPC scale
  const t = trafficMatch(o.allowed_traffic, opts.allowed, opts.allowedMode ?? "all");
  const g = geoMatch(o.geo);
  const fb = frictionBonus(o.friction_minutes);
  const whale = (o.payout ?? 0) >= (opts.whaleThreshold ?? 10);
  const W = whale
    ? { p:0.5, e:0.2, t:0.2, g:0.05, f:0.05 }
    : { p:0.2, e:0.4, t:0.2, g:0.10, f:0.10 };
  return (W.p*payout) + (W.e*epc) + (W.t*t) + (W.g*g) + (W.f*fb);
}

// ===== Upstream adapters (stubs) + KV caching =====
async function kvGetJSON<T = any>(ns: KVNamespace | undefined, key: string): Promise<T | null> {
  if (!ns) return null;
  try {
    const raw = await ns.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch { return null; }
}
async function kvPutJSON(ns: KVNamespace | undefined, key: string, value: any, ttlSec?: number) {
  if (!ns) return;
  try {
    const opts: any = {};
    if (ttlSec && Number(ttlSec) > 0) opts.expirationTtl = Number(ttlSec);
    await ns.put(key, JSON.stringify(value), opts);
  } catch {}
}

type AdapterParams = { geos: string[]; devices: string[]; ctypes: string[]; max: number };

async function maxbountyOffers(params: AdapterParams, env?: Env): Promise<Offer[]> {
  // Try cached KV
  const cacheKey = 'offers:maxbounty';
  const cached = await kvGetJSON<Offer[]>(env?.REGISTRY, cacheKey);
  if (Array.isArray(cached) && cached.length) return cached.slice(0, params.max);

  // Fetch live using email/password auth if configured
  if (!env) return [];
  const res = await mbFetch(resolveMaxBountyOffersPath(env), env).catch(() => null);
  if (!res || !res.ok) return [];
  const data = await safeJson(res).catch(() => ({} as any)).catch(() => ({} as any));
  const arr: any[] = Array.isArray(data)
    ? data
    : Array.isArray((data as any).data)
      ? (data as any).data
      : Array.isArray((data as any).offers)
        ? (data as any).offers
        : [];
  const normalized = arr.map(NormalizeNet('MaxBounty')).filter(o => o.url);
  const ttl = Number(env?.OFFERS_CACHE_TTL || 900);
  await kvPutJSON(env?.REGISTRY, cacheKey, normalized, ttl);
  return normalized.slice(0, params.max);
}

async function myleadOffers(params: AdapterParams, env?: Env, options?: { force?: boolean }): Promise<Offer[]> {
  const cacheKey = 'offers:mylead';
  if (!options?.force) {
    const cached = await kvGetJSON<Offer[]>(env?.REGISTRY, cacheKey);
    if (Array.isArray(cached) && cached.length) return cached.slice(0, params.max);
  }
  // Obtain auth token: prefer configured MYLEAD_API_KEY, else try username/password login flow with caching
  let token = env?.MYLEAD_API_KEY;
  if (!token) {
    token = await getMyleadToken(env);
    if (!token) return [];
  }
  const base = (env?.MYLEAD_BASE || env?.MYLEAD_API_BASE || 'https://api.mylead.eu/api/external/v1/').replace(/\/$/, '/');
  // Resolve offers path
  let offersPath = env?.MYLEAD_OFFERS_PATH || '';
  if (!offersPath) {
    const isPublisher = /\/publisher\//i.test(base);
    offersPath = isPublisher ? 'campaigns' : 'offers';
  }
  // Build URL safely
  const q = new URL((offersPath.startsWith('http') ? offersPath : base + offersPath.replace(/^\//, '')));
  const pageSize = String(Math.min(100, Math.max(20, params.max || 20)));
  // Only set pagination if not explicitly provided in offersPath
  if (!q.searchParams.has('per_page') && !q.searchParams.has('limit')) {
    if (/\/publisher\//i.test(base) || /campaign/i.test(offersPath)) q.searchParams.set('limit', pageSize);
    else q.searchParams.set('per_page', pageSize);
  }
  try {
    const res = await fetch(q.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    // Accept several common shapes
    const arr: any[] = Array.isArray(data)
      ? data
      : Array.isArray((data as any).data)
        ? (data as any).data
        : Array.isArray((data as any).offers)
          ? (data as any).offers
          : Array.isArray((data as any).campaigns)
            ? (data as any).campaigns
            : Array.isArray((data as any).items)
              ? (data as any).items
              : [];
    // Normalize MyLead-specific fields before applying generic normalization
    const normalized = arr.map((raw: any) => {
      const o: any = { ...raw };
      if (!o.url) o.url = raw.trackingLink || raw.link || raw.preview_url || raw.ref_link || '';
      if (o.payout == null && typeof raw.rate === 'number') o.payout = raw.rate;
      if (!Array.isArray(o.geo) && Array.isArray(raw.countries)) o.geo = raw.countries;
      if (!Array.isArray(o.device) && Array.isArray(raw.devices)) o.device = raw.devices;
      if (!Array.isArray(o.allowed_traffic) && Array.isArray(raw.trafficTypes)) o.allowed_traffic = raw.trafficTypes;
      if (!o.notes && raw.descriptionShort) o.notes = raw.descriptionShort;
      return NormalizeNet('MyLead')(o);
    }).filter((o: Offer) => o.url);
    const ttl = Number(env?.OFFERS_CACHE_TTL || 900);
    await kvPutJSON(env?.REGISTRY, cacheKey, normalized, ttl);
    return normalized.slice(0, params.max);
  } catch {
    return [];
  }
}

async function cpagripOffers(params: AdapterParams, env?: Env): Promise<Offer[]> {
  const cacheKey = 'offers:cpagrip';
  const cached = await kvGetJSON<Offer[]>(env?.REGISTRY, cacheKey);
  if (Array.isArray(cached) && cached.length) return cached.slice(0, params.max);
  if (!env?.CPAGRIP_USER_ID || !env?.CPAGRIP_SECRET_KEY) return [];
  const base = (env.CPAGRIP_BASE || 'https://www.cpagrip.com/common/offer_feed_json.php');
  const u = new URL(base);
  u.searchParams.set('user_id', env.CPAGRIP_USER_ID);
  u.searchParams.set('key', env.CPAGRIP_SECRET_KEY);
  if (!u.searchParams.has('format')) u.searchParams.set('format', 'json');
  try {
    const res = await fetch(u.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data: any = await res.json().catch(() => ({}));
    const arr: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data.offers)
        ? data.offers
        : Array.isArray(data.data)
          ? data.data
          : [];
    const normalized = arr.map((raw: any) => {
      const o: any = { ...raw };
      if (!o.url) o.url = raw.offerlink || raw.tracking_url || raw.url || '';
      if (typeof o.payout !== 'number') {
        const n = Number(raw.payout ?? raw.rate);
        if (!Number.isNaN(n)) o.payout = n;
      }
      // Geo normalization and inference
      const geoFrom = (): string[] => {
        const vals: string[] = [];
        const pushVals = (v: any) => {
          if (!v) return;
          if (Array.isArray(v)) v.forEach(x => pushVals(x));
          else String(v).split(',').forEach(x => { const t = x.trim(); if (t) vals.push(t); });
        };
        pushVals(raw.countries);
        pushVals(raw.country);
        pushVals(raw.country_code);
        pushVals(raw.country_iso);
        pushVals(raw.countryIso);
        pushVals(raw.geo);
        const upper = vals.map(s => s.toUpperCase().replace(/[^A-Z]/g, ''))
                          .filter(Boolean);
        // Infer from name if still empty
        if (upper.length === 0) {
          const nameStr = String(raw.name || raw.offer_name || raw.title || '')
            .toUpperCase();
          const known = ["US","CA","UK","AU","DE","FR","IE","NZ","ES","IT","NL","SE","NO","DK"];
          for (const k of known) {
            if (new RegExp(`(^|[^A-Z])${k}([^A-Z]|$)`).test(nameStr)) upper.push(k);
          }
        }
        // de-dup
        return Array.from(new Set(upper));
      };
      if (!Array.isArray(o.geo) || o.geo.length === 0) {
        const g = geoFrom();
        if (g.length) o.geo = g;
      }
      if (!Array.isArray(o.device) && raw.devices) {
        o.device = Array.isArray(raw.devices) ? raw.devices : [String(raw.devices)];
      }
      if (!Array.isArray(o.allowed_traffic) && raw.allowed_traffic_sources) {
        o.allowed_traffic = Array.isArray(raw.allowed_traffic_sources) ? raw.allowed_traffic_sources : [String(raw.allowed_traffic_sources)];
      }
      if (!o.vertical) o.vertical = raw.category || raw.vertical || null;
      return NormalizeNet('CPAGrip')(o);
    }).filter((o: Offer) => o.url);
    const ttl = Number(env?.OFFERS_CACHE_TTL || 900);
    await kvPutJSON(env?.REGISTRY, cacheKey, normalized, ttl);
    return normalized.slice(0, params.max);
  } catch {
    return [];
  }
}

async function ogadsOffers(params: AdapterParams, env?: Env, ctx?: { req?: Request; url?: URL }): Promise<Offer[]> {
  const cacheKey = 'offers:ogads';
  const cached = await kvGetJSON<Offer[]>(env?.REGISTRY, cacheKey);
  if (Array.isArray(cached) && cached.length) return cached.slice(0, params.max);
  if (!env?.OGADS_API_KEY) return [];
  const base = (env.OGADS_BASE || 'https://unlockcontent.net/api/v2').replace(/\/$/, '');
  const path = (env.OGADS_OFFERS_PATH || '/offers');
  const endpoint = base + (path.startsWith('/') ? path : '/' + path);
  // Required query params: ip, user_agent; optional: ctype, max, min
  const req = ctx?.req;
  const srcUrl = ctx?.url;
  const ip = req?.headers.get('CF-Connecting-IP')
    || (req?.headers.get('X-Forwarded-For') || '').split(',')[0].trim()
    || '8.8.8.8';
  const ua = req?.headers.get('User-Agent') || 'Mozilla/5.0 (compatible; AIQBrain/1.0)';
  const q = new URL(endpoint);
  q.searchParams.set('ip', ip);
  q.searchParams.set('user_agent', ua);
  // Allow override via query string if provided
  const ogCtype = srcUrl?.searchParams.get('ogads_ctype');
  if (ogCtype != null && ogCtype !== '') q.searchParams.set('ctype', ogCtype);
  // Max/min
  q.searchParams.set('max', String(params.max || 50));
  const minPayoutStr = srcUrl?.searchParams.get('min_payout') || srcUrl?.searchParams.get('payout_min');
  if (minPayoutStr) {
    const v = Number(minPayoutStr);
    if (!Number.isNaN(v) && v > 0) q.searchParams.set('min', String(v));
  }
  try {
    const res = await fetch(q.toString(), { headers: { Authorization: `Bearer ${env.OGADS_API_KEY}`, Accept: 'application/json' }});
    if (!res.ok) return [];
    const data: any = await res.json().catch(() => ({}));
    const arr: any[] = Array.isArray(data) ? data
      : Array.isArray(data.data) ? data.data
      : Array.isArray(data.offers) ? data.offers
      : Array.isArray(data.items) ? data.items
      : [];
    const normalized = arr.map((raw: any) => {
      const o: any = { ...raw };
      if (!o.url) o.url = raw.tracking_url || raw.trackingLink || raw.link || raw.preview_url || raw.ref_link || '';
      if (typeof o.payout !== 'number') {
        const n = Number(raw.payout ?? raw.rate);
        if (!Number.isNaN(n)) o.payout = n;
      }
      if (!Array.isArray(o.geo)) {
        if (raw.country) o.geo = [String(raw.country)];
        else if (Array.isArray(raw.countries)) o.geo = raw.countries;
      }
      if (!Array.isArray(o.device) && raw.devices) o.device = Array.isArray(raw.devices) ? raw.devices : [String(raw.devices)];
      if (!Array.isArray(o.allowed_traffic) && (raw.allowed_traffic_sources || raw.allowed_traffic)) {
        const a = raw.allowed_traffic_sources ?? raw.allowed_traffic;
        o.allowed_traffic = Array.isArray(a) ? a : [String(a)];
      }
      if (!o.vertical) o.vertical = raw.category || raw.vertical || null;
      return NormalizeNet('OGAds')(o);
    }).filter((o: Offer) => o.url);
    const ttl = Number(env?.OFFERS_CACHE_TTL || 900);
    await kvPutJSON(env?.REGISTRY, cacheKey, normalized, ttl);
    return normalized.slice(0, params.max);
  } catch {
    return [];
  }
}

// ---- MyLead login token helper (username/password -> Bearer) ----
async function getMyleadToken(env?: Env): Promise<string | null> {
  if (!env) return null;
  // Try cached token in KV first
  const cached = await kvGetJSON<{ token: string }>(env.REGISTRY, 'secrets:mylead_token');
  if (cached?.token) return cached.token;
  // No cached token — try to login using username/password
  return await refreshMyleadToken(env);
}

async function refreshMyleadToken(env: Env): Promise<string | null> {
  if (!env?.MYLEAD_USERNAME || !env?.MYLEAD_PASSWORD) return null;
  const base = (env.MYLEAD_BASE || env.MYLEAD_API_BASE || 'https://api.mylead.eu/api/external/v1/').replace(/\/$/, '/');
  const loginUrls = [base + 'auth/login', base + 'login']; // try common endpoints
  const bodies = [
    { username: env.MYLEAD_USERNAME, password: env.MYLEAD_PASSWORD },
    { email: env.MYLEAD_USERNAME, password: env.MYLEAD_PASSWORD }
  ];
  let token: string | null = null;
  for (const url of loginUrls) {
    for (const body of bodies) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res.ok) continue;
        const json: any = await res.json().catch(() => ({}));
        token = json?.access_token || json?.token || json?.accessToken || null;
        if (token) break;
      } catch {}
    }
    if (token) break;
  }
  if (!token) return null;
  const ttl = Number(env.MYLEAD_TOKEN_TTL || 10800); // default 3 hours
  await kvPutJSON(env.REGISTRY, 'secrets:mylead_token', { token }, ttl);
  return token;
}

// ===== MaxBounty auth (email/password -> mb-api-token) =====
type MbTokenMem = { value: string; exp: number } | null;
let mbTokenMem: MbTokenMem = null;

function maxbountyBase(env?: Env) {
  return (env?.MAXBOUNTY_BASE || 'https://affiliates.maxbounty.com').replace(/\/$/, '');
}
function resolveMaxBountyOffersPath(env: Env) {
  // Configurable; try a sensible default if not provided.
  const path = env.MAXBOUNTY_OFFERS_PATH || '/offers';
  return path.startsWith('/') ? path : `/${path}`;
}

async function getMaxBountyToken(env: Env): Promise<string | null> {
  const now = Date.now();
  if (mbTokenMem && now < mbTokenMem.exp) return mbTokenMem.value;
  // try KV
  const cached = await kvGetJSON<{ token: string; exp?: number }>(env.REGISTRY, 'secrets:maxbounty_token');
  if (cached?.token) {
    // If exp missing, trust it for remaining TTL handled by KV; still set a short in-mem window
    const exp = cached.exp && cached.exp > now ? cached.exp : now + 20 * 60 * 1000;
    mbTokenMem = { value: cached.token, exp };
    return cached.token;
  }
  return await refreshMaxBountyToken(env);
}

async function refreshMaxBountyToken(env: Env): Promise<string | null> {
  const email = env.MAXBOUNTY_EMAIL || '';
  const password = env.MAXBOUNTY_PASSWORD || '';
  if (!email || !password) return null;
  const authUrl = maxbountyBase(env) + '/authentication';
  try {
    const res = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data: any = await res.json().catch(() => ({}));
    const token = data?.['mb-api-token'];
    if (!res.ok || !token) return null;
    // token lasts ~2h. Refresh ~100m ahead of hard expiry.
    const now = Date.now();
    const ttlSec = Number(env.MAXBOUNTY_TOKEN_TTL || 6000); // default ~100 minutes
    const exp = now + ttlSec * 1000;
    mbTokenMem = { value: token, exp };
    await kvPutJSON(env.REGISTRY, 'secrets:maxbounty_token', { token, exp }, ttlSec);
    return token;
  } catch {
    return null;
  }
}

async function mbFetch(path: string, env: Env): Promise<Response> {
  const base = maxbountyBase(env);
  let token = await getMaxBountyToken(env);
  if (!token) throw new Error('MaxBounty token not available');
  let res = await fetch(base + path, { headers: { 'x-access-token': token } });
  if (res.status === 401) {
    // refresh once
    mbTokenMem = null;
    token = await refreshMaxBountyToken(env);
    if (!token) return res;
    res = await fetch(base + path, { headers: { 'x-access-token': token } });
  }
  return res;
}

function NormalizeNet(networkName: string) {
  return (o: any): Offer => ({
    id: o.id || o.offer_id || o.campaign_id || cryptoRandomId(),
    name: o.name || o.title || o.campaign_name || '',
    url: o.url || o.tracking_url || o.link || o.ref_link || o.preview_url || '',
    network: o.network || networkName,
    payout: o.payout ?? null,
    epc: o.epc ?? null,
    geo: Array.isArray(o.geo) ? o.geo : (Array.isArray(o.countries) ? o.countries : (o.geo ? [String(o.geo)] : [])),
    device: Array.isArray(o.device) ? o.device : (o.device ? [String(o.device)] : []),
    vertical: o.vertical || o.category || o.vertical_name || null,
    allowed_traffic: Array.isArray(o.allowed_traffic) ? o.allowed_traffic : (o.allowed_sources ? o.allowed_sources : (o.allowed_traffic ? [String(o.allowed_traffic)] : [])),
    friction_minutes: o.friction_minutes ?? null,
    notes: o.notes || ''
  });
}
function cryptoRandomId() {
  // best-effort unique ID when upstream lacks one
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function splitOffers(
  offers: Offer[],
  reqAllowed: string[],
  opts: { frictionMax: number; payoutMin: number; allowedMode: "all" | "any" }
) {
  const RA = normalize(reqAllowed);
  const green: Offer[] = [];
  const yellow: Offer[] = [];

  for (const o of offers) {
    const oa = normalize(o.allowed_traffic);
    const trafficOK = RA.length === 0
      ? true
      : (opts.allowedMode === "all"
          ? RA.every(ch => oa.includes(ch))
          : RA.some(ch => oa.includes(ch)));

    const frictionOK = (o.friction_minutes ?? 999) <= opts.frictionMax;
    const payoutOK = (o.payout ?? 0) >= opts.payoutMin;

    const withScore: Offer = { ...o, _score: scoreOffer(o, { allowed: RA, allowedMode: opts.allowedMode }) };
    const isGreen = trafficOK && frictionOK && payoutOK;
    const withTier: Offer = { ...withScore, tier: isGreen ? "green" : "yellow" };
    (isGreen ? green : yellow).push(withTier);
  }

  green.sort((a,b) => (b._score ?? 0) - (a._score ?? 0));
  yellow.sort((a,b) => (b._score ?? 0) - (a._score ?? 0));

  return {
    green,
    yellow,
    counts: { green: green.length, yellow: yellow.length, total: offers.length },
    rules: {
      payout_min: opts.payoutMin,
      friction_max: opts.frictionMax,
      allowed_traffic_mode: opts.allowedMode
    }
  };
}

function okCORS(origin?: string) {
  // allow Actions + quick testing
  const allow = origin ?? "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Api-Key, Authorization, Accept",
    "Access-Control-Max-Age": "86400",
  };
}

function unauthorized(origin?: string) {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      ...okCORS(origin),
    }
  });
}

function getApiKey(req: Request) {
  const h = req.headers;
  const fromHeader = h.get("X-Api-Key");
  const bearer = h.get("Authorization");
  if (fromHeader) return fromHeader.trim();
  if (bearer?.startsWith("Bearer ")) return bearer.slice(7).trim();
  return null;
}

function isKeyAllowed(key: string | null, env: Env) {
  if (!env.AIQ_API_KEYS) return false;
  const set = env.AIQ_API_KEYS.split(",").map(s => s.trim()).filter(Boolean);
  return !!(key && set.includes(key));
}

async function safeJson(res: Response) {
  // Avoid 1101 when upstream returns HTML/CF error
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text();
    throw new Error(`Upstream non-JSON (${res.status}): ${text.slice(0, 300)}`);
  }
  return await res.json();
}

function matchKeywords(o: Offer, keywordsCsv?: string | null) {
  const kw = (keywordsCsv || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!kw.length) return true;
  const hay = `${o.name} ${o.vertical} ${o.id}`.toLowerCase();
  return kw.some(k => hay.includes(k));
}

async function handleSearch(url: URL, env?: Env, req?: Request): Promise<Offer[]> {
  // Prepare requested filters for potential upstream adapters
  const reqGeos = csv(url.searchParams.get("geo"));
  const reqDevices = csv(url.searchParams.get("device"));
  const reqCtypes = csv(url.searchParams.get("ctype"));
  // Use curated registry merged with fallbacks, then filter by query.
  const geos = csv(url.searchParams.get("geo"));
  const devices = csv(url.searchParams.get("device"));
  const ctypes = csv(url.searchParams.get("ctype"));
  const networks = csv(url.searchParams.get("network"));
  const max = Math.min(parseInt(url.searchParams.get("max") || "20", 10), 50);
  const channel = url.searchParams.get("channel")?.trim();
  const allowedTraffic = csv(url.searchParams.get("allowed_traffic"));
  if (channel) allowedTraffic.push(channel.toLowerCase());
  const keywords = url.searchParams.get("keywords");
  const minPayout = Number(url.searchParams.get("min_payout") ?? url.searchParams.get("payout_min") ?? 0);

  const registryOffers: RegOffer[] = Array.isArray((REGISTRY as any)?.offers) ? (REGISTRY as any).offers : [];
  // Optionally include cached upstream offers (e.g., maxbounty, mylead) if enabled
  let external: Offer[] = [];
  try {
    const enabled = new Set(csv(env?.NETWORKS_ENABLED || ""));
    if (enabled.has("ogads")) {
      const og = await ogadsOffers({ geos: reqGeos, devices: reqDevices, ctypes: reqCtypes, max }, env, { req, url });
      external = external.concat(og);
    }
    if (enabled.has("cpagrip")) {
      const cg = await cpagripOffers({ geos: reqGeos, devices: reqDevices, ctypes: reqCtypes, max }, env);
      external = external.concat(cg);
    }
    if (enabled.has("maxbounty")) {
      const mb = await maxbountyOffers({ geos: reqGeos, devices: reqDevices, ctypes: reqCtypes, max }, env);
      external = external.concat(mb);
    }
    if (enabled.has("mylead")) {
      const ml = await myleadOffers({ geos: reqGeos, devices: reqDevices, ctypes: reqCtypes, max }, env);
      external = external.concat(ml);
    }
  } catch {}
  // Merge by URL to avoid duplicates; prefer registry data over fallbacks
  const mergedMap = new Map<string, Offer>();
  for (const src of [...external, ...registryOffers, ...FALLBACK_OFFERS]) {
    const key = (src.url || "") as string;
    if (!key) continue;
    if (!mergedMap.has(key)) mergedMap.set(key, src as Offer);
  }
  let list = Array.from(mergedMap.values());

  if (geos.length) {
    const includeEmptyGeo = /^(1|true|yes|on)$/i.test(url.searchParams.get("include_empty_geo") || "");
    const wanted = geos.map(g => g.toUpperCase());
    list = list.filter(o => {
      const og = (o.geo || []).map(g => g.toUpperCase());
      if (includeEmptyGeo && og.length === 0) return true;
      return anyMatch(og, wanted);
    });
  }
  if (devices.length) {
    const wanted = devices;
    list = list.filter(o => anyMatch(o.device.map(d => d.toLowerCase()), wanted));
  }
  if (ctypes.length && ctypes[0] !== "*") {
    const tokens = ctypes.map(t => t.toLowerCase().replace(/[^a-z0-9]+/g, "")).filter(Boolean);
    list = list.filter(o => {
      const hay = `${o.vertical || ""} ${o.id || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
      return tokens.some(tok => hay.includes(tok));
    });
  }
  if (networks.length) {
    const nets = new Set(networks);
    list = list.filter(o => nets.has((o.network || "").toLowerCase()));
  }
  if (allowedTraffic.length) {
    list = list.filter(o => anyMatch((o.allowed_traffic || []).map(t => t.toLowerCase()), allowedTraffic));
  }
  if (keywords) {
    list = list.filter(o => matchKeywords(o, keywords));
  }
  if (!Number.isNaN(minPayout) && minPayout > 0) {
    list = list.filter(o => (o.payout ?? 0) >= minPayout);
  }

  return list.slice(0, max);
}

// ----- OpenAPI specs (JSON + YAML) -----

const OPENAPI_JSON = () => JSON.stringify({
  openapi: "3.1.0",
  info: {
    title: "AIQBrain Offer Engine (workers)",
    version: "1.1.0",
    description: "Search normalized CPA/CPI offers with traffic and payout tiering."
  },
  servers: [
    { url: "https://aiqbrain-offer-engine.jasonhslaughter.workers.dev" }
  ],
  paths: {
    "/offers/health": {
      get: {
        operationId: "health",
        summary: "Health check",
        responses: {
          "200": {
            description: "OK",
            content: { "text/plain": { schema: { type: "string", example: "ok" } } }
          }
        }
      }
    },
    "/offers/search": {
      get: {
        operationId: "searchOffers",
        summary: "Search normalized CPA offers",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { in: "query", name: "geo", description: "CSV of country codes", schema: { type: "string", example: "US,CA,UK" } },
          { in: "query", name: "device", description: "CSV of devices", schema: { type: "string", example: "mobile,desktop", default: "mobile" } },
          { in: "query", name: "ctype", description: "CSV of content types or * for no filter", schema: { type: "string", example: "CPA,CPI,SOI,DOI,Trial,Deposit" } },
          { in: "query", name: "keywords", schema: { type: "string", example: "sweeps,gift card" } },
          { in: "query", name: "network", description: "Comma-separated networks", schema: { type: "string", example: "ogads,cpagrip" } },
          { in: "query", name: "max", schema: { type: "integer", default: 20, maximum: 50 } },
          { in: "query", name: "min_payout", schema: { type: "number" } },
          { in: "query", name: "allowed_traffic", description: "CSV of traffic sources", schema: { type: "string", example: "Reddit,TikTok,Pinterest" } },
          { in: "query", name: "channel", description: "Single traffic channel (alias for allowed_traffic)", schema: { type: "string", example: "TikTok" } },
          { in: "query", name: "friction_max", description: "Max minutes for GREEN tier when split_mode=traffic", schema: { type: "integer", example: 7 } },
          { in: "query", name: "allowed_traffic_mode", schema: { type: "string", enum: ["all","any"], default: "all" } },
          { in: "query", name: "split", schema: { type: "boolean", example: true } },
          { in: "query", name: "split_mode", schema: { type: "string", enum: ["traffic","payout"], default: "traffic" } },
          { in: "query", name: "whale_threshold", description: "Minimum payout for whales split", schema: { type: "number", default: 10 } }
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      type: "object",
                      properties: {
                        offers: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["id","name","url","network"],
                            properties: {
                              id: { type: "string" },
                              name: { type: "string" },
                              url: { type: "string", format: "uri" },
                              network: { type: "string" },
                              payout: { type: "number", nullable: true },
                              epc: { type: "number", nullable: true },
                              geo: { type: "array", items: { type: "string" } },
                              device: { type: "array", items: { type: "string" } },
                              vertical: { type: "string", nullable: true },
                              allowed_traffic: { type: "array", items: { type: "string" } },
                              friction_minutes: { type: "integer", nullable: true },
                              notes: { type: "string", nullable: true }
                            }
                          }
                        }
                      },
                      required: ["offers"]
                    },
                    {
                      type: "object",
                      properties: {
                        meta: {
                          type: "object",
                          properties: {
                            geo: { type: "string" },
                            device: { type: "string" },
                            ctype: { type: "string" },
                            networks: { type: "array", items: { type: "string" } },
                            keywords: { type: "string" },
                            min_payout: { type: "number" },
                            friction_max: { type: "integer" },
                            allowed_traffic: { type: "array", items: { type: "string" } },
                            channel: { type: "string" },
                            allowed_traffic_mode: { type: "string", enum: ["all","any"] }
                          },
                          additionalProperties: true
                        },
                        green: {
                          type: "array",
                          items: { $ref: "#/components/schemas/Offer" }
                        },
                        yellow: {
                          type: "array",
                          items: { $ref: "#/components/schemas/Offer" }
                        },
                        counts: {
                          type: "object",
                          properties: {
                            green: { type: "integer" },
                            yellow: { type: "integer" },
                            total: { type: "integer" }
                          }
                        },
                        rules: {
                          type: "object",
                          properties: {
                            payout_min: { type: "number" },
                            friction_max: { type: "integer" },
                            allowed_traffic_mode: { type: "string", enum: ["all","any"] }
                          }
                        }
                      },
                      required: ["meta","green","yellow"]
                    }
                  ,
                  {
                    type: "object",
                    properties: {
                      meta: { type: "object", additionalProperties: true },
                      whales: { type: "array", items: { $ref: "#/components/schemas/Offer" } },
                      minnows: { type: "array", items: { $ref: "#/components/schemas/Offer" } },
                      counts: { type: "object", properties: { whales: { type: "integer" }, minnows: { type: "integer" }, total: { type: "integer" } } },
                      rules: { type: "object", properties: { whale_threshold: { type: "number" } } }
                    },
                    required: ["meta","whales","minnows"]
                  }
                  ]
                }
              }
            }
          },
          "401": { description: "Unauthorized" },
          "500": { description: "Server error" }
        }
      }
    }
  },
  components: {
    schemas: {
      Offer: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          url: { type: "string", format: "uri" },
          network: { type: "string" },
          payout: { type: "number", nullable: true },
          epc: { type: "number", nullable: true },
          geo: { type: "array", items: { type: "string" } },
          device: { type: "array", items: { type: "string" } },
          vertical: { type: "string", nullable: true },
          allowed_traffic: { type: "array", items: { type: "string" } },
          friction_minutes: { type: "integer", nullable: true },
          notes: { type: "string", nullable: true },
          _score: { type: "number", nullable: true },
          tier: { type: "string", enum: ["green","yellow"], nullable: true }
        },
        required: ["id","name","url","network"]
      }
    },
    securitySchemes: {
      ApiKeyAuth: { type: "apiKey", in: "header", name: "X-Api-Key" }
    }
  }
});

const OPENAPI_YAML = () => [
  "openapi: 3.1.0",
  "info:",
  "  title: AIQBrain Offer Engine (workers)",
  "  version: 1.1.0",
  "  description: Search normalized CPA/CPI offers with traffic and payout tiering.",
  "servers:",
  "  - url: https://aiqbrain-offer-engine.jasonhslaughter.workers.dev",
  "paths:",
  "  /offers/health:",
  "    get:",
  "      operationId: health",
  "      summary: Health check",
  "      responses:",
  "        \"200\":",
  "          description: OK",
  "          content:",
  "            text/plain:",
  "              schema:",
  "                type: string",
  "                example: ok",
  "  /offers/search:",
  "    get:",
  "      operationId: searchOffers",
  "      summary: Search normalized CPA offers",
  "      security: [{ ApiKeyAuth: [] }]",
  "      parameters:",
  "        - in: query",
  "          name: geo",
  "          description: CSV of country codes",
  "          schema: { type: string, example: US,CA,UK }",
  "        - in: query",
  "          name: device",
  "          description: CSV of devices",
  "          schema: { type: string, example: mobile, default: mobile }",
  "        - in: query",
  "          name: ctype",
  "          description: CSV of types or *",
  "          schema: { type: string, example: \"CPA,CPI,SOI,DOI,Trial,Deposit\" }",
  "        - in: query",
  "          name: keywords",
  "          schema: { type: string, example: \"sweeps,gift card\" }",
  "        - in: query",
  "          name: network",
  "          description: Comma-separated networks",
  "          schema: { type: string, example: \"ogads,cpagrip\" }",
  "        - in: query",
  "          name: max",
  "          schema: { type: integer, default: 20, maximum: 50 }",
  "        - in: query",
  "          name: min_payout",
  "          schema: { type: number }",
  "        - in: query",
  "          name: allowed_traffic",
  "          description: CSV of traffic sources",
  "          schema: { type: string, example: \"Reddit,TikTok,Pinterest\" }",
  "        - in: query",
  "          name: channel",
  "          description: Single traffic channel (alias for allowed_traffic)",
  "          schema: { type: string, example: \"TikTok\" }",
  "        - in: query",
  "          name: friction_max",
  "          description: Max minutes for GREEN tier when split_mode=traffic",
  "          schema: { type: integer, example: 7 }",
  "        - in: query",
  "          name: allowed_traffic_mode",
  "          schema: { type: string, enum: [all, any], default: all }",
  "        - in: query",
  "          name: split",
  "          schema: { type: boolean, example: true }",
  "        - in: query",
  "          name: split_mode",
  "          schema: { type: string, enum: [traffic, payout], default: traffic }",
  "        - in: query",
  "          name: whale_threshold",
  "          schema: { type: number, default: 10 }",
  "      responses:",
  "        \"200\":",
  "          description: OK",
  "          content:",
  "            application/json:",
  "              schema:",
  "                oneOf:",
  "                  - type: object",
  "                    properties:",
  "                      offers:",
  "                        type: array",
  "                        items:",
  "                          $ref: \"#/components/schemas/Offer\"",
  "                    required: [offers]",
  "                  - type: object",
  "                    properties:",
  "                      meta:",
  "                        type: object",
  "                      green:",
  "                        type: array",
  "                        items:",
  "                          $ref: \"#/components/schemas/Offer\"",
  "                      yellow:",
  "                        type: array",
  "                        items:",
  "                          $ref: \"#/components/schemas/Offer\"",
  "                      counts:",
  "                        type: object",
  "                        properties:",
  "                          green: { type: integer }",
  "                          yellow: { type: integer }",
  "                          total: { type: integer }",
  "                      rules:",
  "                        type: object",
  "                        properties:",
  "                          payout_min: { type: number }",
  "                          friction_max: { type: integer }",
  "                          allowed_traffic_mode: { type: string, enum: [all, any] }",
  "                    required: [meta, green, yellow]",
  "                  - type: object",
  "                    properties:",
  "                      meta:",
  "                        type: object",
  "                      whales:",
  "                        type: array",
  "                        items:",
  "                          $ref: \"#/components/schemas/Offer\"",
  "                      minnows:",
  "                        type: array",
  "                        items:",
  "                          $ref: \"#/components/schemas/Offer\"",
  "                      counts:",
  "                        type: object",
  "                        properties:",
  "                          whales: { type: integer }",
  "                          minnows: { type: integer }",
  "                          total: { type: integer }",
  "                      rules:",
  "                        type: object",
  "                        properties:",
  "                          whale_threshold: { type: number }",
  "                    required: [meta, whales, minnows]",
  "                  - type: object",
  "                    properties:",
  "                      meta:",
  "                        type: object",
  "                      whales:",
  "                        type: array",
  "                        items:",
  "                          $ref: \"#/components/schemas/Offer\"",
  "                      minnows:",
  "                        type: array",
  "                        items:",
  "                          $ref: \"#/components/schemas/Offer\"",
  "                      counts:",
  "                        type: object",
  "                        properties:",
  "                          whales: { type: integer }",
  "                          minnows: { type: integer }",
  "                          total: { type: integer }",
  "                      rules:",
  "                        type: object",
  "                        properties:",
  "                          whale_threshold: { type: number }",
  "                    required: [meta, whales, minnows]",
  "        \"401\":",
  "          description: Unauthorized",
  "        \"500\":",
  "          description: Server error",
  "components:",
  "  schemas:",
  "    Offer:",
  "      type: object",
  "      properties:",
  "        id: { type: string }",
  "        name: { type: string }",
  "        url: { type: string, format: uri }",
  "        network: { type: string }",
  "        payout: { type: number, nullable: true }",
  "        epc: { type: number, nullable: true }",
  "        geo: { type: array, items: { type: string } }",
  "        device: { type: array, items: { type: string } }",
  "        vertical: { type: string, nullable: true }",
  "        allowed_traffic: { type: array, items: { type: string } }",
  "        friction_minutes: { type: integer, nullable: true }",
  "        notes: { type: string, nullable: true }",
  "        _score: { type: number, nullable: true }",
  "        tier: { type: string, enum: [green, yellow], nullable: true }",
  "      required: [id, name, url, network]",
  "  securitySchemes:",
  "    ApiKeyAuth:",
  "      type: apiKey",
  "      in: header",
  "      name: X-Api-Key",

].join("\n");

const AI_PLUGIN_JSON = () => JSON.stringify({
  schema_version: "v1",
  name_for_human: "AIQBrain Offer Engine",
  name_for_model: "aiqbrain_offer_engine",
  description_for_human: "Search and rank CPA offers (US mobile PIN submits, etc.).",
  description_for_model: "Use searchOffers to retrieve and rank CPA offers. Default filters: geo=US, device=mobile, ctype=CPA+PIN. Respect allowed_traffic and friction_minutes. You may pass 'allowed_traffic' (comma CSV) or the single-value alias 'channel'.",
  auth: {
    type: "user_http",
    authorization_type: "bearer"
  },
  api: {
    type: "openapi",
    url: "https://aiqbrain-offer-engine.jasonhslaughter.workers.dev/openapi.json",
    is_user_authenticated: true
  },
  legal_info_url: "https://aiqbrain-offer-engine.jasonhslaughter.workers.dev",
  contact_email: "support@example.com"
});

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
    const { pathname } = new URL(req.url);
    const originHdr = req.headers.get("Origin") || "*";

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: okCORS(originHdr) });
    }

    // health (public) — supports HEAD and JSON/text negotiation
    if (pathname === "/offers/health") {
      if (req.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { ...okCORS(originHdr) }
        });
      }
      if (req.method === "GET") {
        const accept = req.headers.get("accept") || "";
        const url = new URL(req.url);
        const wantDetail = (url.searchParams.get("detail") || "").toLowerCase() 
          .match(/^(1|true|yes|on)$/) != null;
        if (accept.includes("application/json") || wantDetail) {
          // Build a quick view of merged offers and settings
          const registryOffers: RegOffer[] = Array.isArray((REGISTRY as any)?.offers) ? (REGISTRY as any).offers : [];
          const mergedMap = new Map<string, Offer>();
          for (const src of [...registryOffers, ...FALLBACK_OFFERS]) {
            const key = (src.url || "") as string;
            if (!key) continue;
            if (!mergedMap.has(key)) mergedMap.set(key, src as Offer);
          }
          const merged = Array.from(mergedMap.values());
          const networks = Array.from(new Set(merged.map(o => (o.network || "").toLowerCase()).filter(Boolean)));
          const geos = Array.from(new Set(merged.flatMap(o => (o.geo || []).map(g => g.toUpperCase()))));
          const devices = Array.from(new Set(merged.flatMap(o => (o.device || []).map(d => d.toLowerCase()))));

          const payload = {
            status: "ok",
            time: new Date().toISOString(),
            info: { service: "aiqbrain-offer-engine", version: JSON.parse(OPENAPI_JSON()).info?.version || "" },
            config: {
              api_keys_configured: (env.AIQ_API_KEYS || "").split(",").map(s=>s.trim()).filter(Boolean).length,
              base_url: env.BASE_URL || undefined,
              networks_enabled: env.NETWORKS_ENABLED || undefined,
              green_max_minutes: env.GREEN_MAX_MINUTES || undefined
            },
            counts: {
              registry: registryOffers.length,
              fallbacks: FALLBACK_OFFERS.length,
              merged: merged.length
            },
            coverage: { networks, geos, devices }
          };
          return new Response(JSON.stringify(payload), {
            headers: { "Content-Type": "application/json; charset=utf-8", ...okCORS(originHdr) }
          });
        }
        return new Response("ok", {
          headers: { "Content-Type": "text/plain; charset=utf-8", ...okCORS(originHdr) }
        });
      }
    }

    // serve OpenAPI specs
    // plugin/Actions manifest
    if (req.method === "GET" && pathname === "/.well-known/ai-plugin.json") {
      return new Response(AI_PLUGIN_JSON(), {
        headers: { "Content-Type": "application/json; charset=utf-8", ...okCORS(originHdr) }
      });
    }
    if (req.method === "GET" && (pathname === "/openapi.json" || pathname === "/.well-known/openapi.json")) {
      return new Response(OPENAPI_JSON(), { headers: { "Content-Type": "application/json", ...okCORS(originHdr) }});
    }
    if (req.method === "GET" && pathname === "/openapi.yaml") {
      return new Response(OPENAPI_YAML(), { headers: { "Content-Type": "text/yaml; charset=utf-8", ...okCORS(originHdr) }});
    }

    // simple index page for manual checks
    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"/>
<title>AIQBrain Offer Engine</title>
<body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px;">
  <h1>AIQBrain Offer Engine</h1>
  <ul>
    <li><a href="/offers/health">/offers/health</a></li>
    <li><a href="/openapi.json">/openapi.json</a></li>
    <li><a href="/openapi.yaml">/openapi.yaml</a></li>
    <li><a href="/.well-known/ai-plugin.json">/.well-known/ai-plugin.json</a></li>
    <li><code>/offers/search</code> (requires X-Api-Key)</li>
  </ul>
</body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...okCORS(originHdr) }});
    }

    // auth for protected endpoints
    if (pathname.startsWith("/offers/") && pathname !== "/offers/health") {
      const key = getApiKey(req);
      if (!isKeyAllowed(key, env)) {
        return unauthorized(originHdr);
      }
    }

    try {
      // Admin: refresh MyLead cache (protected by /offers/* auth)
      if (req.method === "POST" && pathname === "/offers/admin/refresh/mylead") {
        const url = new URL(req.url);
        const max = Math.min(200, Number(url.searchParams.get("max") || 100));
        const params = { geos: [], devices: [], ctypes: [], max };
        ctx.waitUntil(myleadOffers(params, env, { force: true }).then(() => undefined));
        return new Response(JSON.stringify({ status: "accepted", action: "refresh_mylead", max }), {
          status: 202,
          headers: { "Content-Type": "application/json", ...okCORS(originHdr) }
        });
      }
      // Admin: refresh MaxBounty login token
      if (req.method === "POST" && pathname === "/offers/admin/auth/maxbounty/refresh-token") {
        const token = await refreshMaxBountyToken(env);
        if (!token) {
          return new Response(JSON.stringify({ status: "error", error: "Unable to fetch token (check credentials)" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...okCORS(originHdr) }
          });
        }
        return new Response(JSON.stringify({ status: "ok", token_prefix: token.slice(0, 12) + "…" }), {
          headers: { "Content-Type": "application/json", ...okCORS(originHdr) }
        });
      }
      // Admin: refresh MaxBounty offers cache (best-effort)
      if (req.method === "POST" && pathname === "/offers/admin/refresh/maxbounty") {
        const url = new URL(req.url);
        const max = Math.min(200, Number(url.searchParams.get("max") || 100));
        const params = { geos: [], devices: [], ctypes: [], max };
        ctx.waitUntil(maxbountyOffers(params, env).then(() => undefined));
        return new Response(JSON.stringify({ status: "accepted", action: "refresh_maxbounty", max }), {
          status: 202,
          headers: { "Content-Type": "application/json", ...okCORS(originHdr) }
        });
      }
      // Admin: refresh MyLead login token (using MYLEAD_USERNAME/MYLEAD_PASSWORD secrets)
      if (req.method === "POST" && pathname === "/offers/admin/auth/mylead/refresh-token") {
        const token = await refreshMyleadToken(env);
        if (!token) {
          return new Response(JSON.stringify({ status: "error", error: "Unable to fetch token (check base/credentials)" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...okCORS(originHdr) }
          });
        }
        return new Response(JSON.stringify({ status: "ok", token_prefix: token.slice(0, 12) + "…" }), {
          headers: { "Content-Type": "application/json", ...okCORS(originHdr) }
        });
      }
      // ---------- Public Vault (no API key required) ----------
      if (req.method === "GET" && pathname === "/vault") {
        return serveVault(originHdr);
      }

      // Admin: refresh CPAGrip offers (protected)
      if (req.method === "POST" && pathname === "/offers/admin/refresh/cpagrip") {
        const url = new URL(req.url);
        const max = Math.min(200, Number(url.searchParams.get("max") || 100));
        const params = { geos: [], devices: [], ctypes: [], max };
        try { await env.REGISTRY?.delete?.('offers:cpagrip'); } catch {}
        ctx.waitUntil(cpagripOffers(params, env).then(() => undefined));
        return new Response(JSON.stringify({ status: "accepted", action: "refresh_cpagrip", max }), {
          status: 202,
          headers: { "Content-Type": "application/json", ...okCORS(originHdr) }
        });
      }

      // Admin: refresh OGAds offers (protected)
      if (req.method === "POST" && pathname === "/offers/admin/refresh/ogads") {
        const url = new URL(req.url);
        const max = Math.min(200, Number(url.searchParams.get("max") || 100));
        const params = { geos: [], devices: [], ctypes: [], max };
        try { await env.REGISTRY?.delete?.('offers:ogads'); } catch {}
        ctx.waitUntil(ogadsOffers(params, env).then(() => undefined));
        return new Response(JSON.stringify({ status: "accepted", action: "refresh_ogads", max }), {
          status: 202,
          headers: { "Content-Type": "application/json", ...okCORS(originHdr) }
        });
      }

      // Admin: debug adapters (normalized view)
      if (req.method === "GET" && pathname.startsWith("/offers/admin/debug/")) {
        const net = pathname.split("/").pop()?.toLowerCase() || "";
        const max = Math.min(200, Number(new URL(req.url).searchParams.get("max") || 50));
        const params = { geos: [], devices: [], ctypes: [], max } as AdapterParams;
        let items: Offer[] = [];
        if (net === 'cpagrip') items = await cpagripOffers(params, env);
        else if (net === 'ogads') items = await ogadsOffers(params, env, { req, url: new URL(req.url) });
        else if (net === 'mylead') items = await myleadOffers(params, env, { force: true });
        else if (net === 'maxbounty') items = await maxbountyOffers(params, env);
        else return new Response(JSON.stringify({ error: 'unknown network' }), { status: 400, headers: { 'Content-Type': 'application/json', ...okCORS(originHdr) } });
        const sample = items.slice(0, 10).map(o => ({ id: o.id, name: o.name, payout: o.payout, geo: o.geo, url: o.url }));
        return new Response(JSON.stringify({ network: net, count: items.length, sample }), { headers: { 'Content-Type': 'application/json', ...okCORS(originHdr) } });
      }

      // Admin: trait inspector GUI (HTML)
      if (req.method === "GET" && pathname === "/offers/admin/inspector") {
        return serveInspector(originHdr);
      }

      // Admin: trait inspector API (JSON)
      if ((req.method === "POST" || req.method === "GET") && pathname === "/offers/admin/inspect") {
        try {
          const url = new URL(req.url);
          let body: any = {};
          if (req.method === 'POST') {
            try { body = await req.json(); } catch { body = {}; }
          } else {
            // Map query params to body shape
            body = {
              ids: (url.searchParams.get('ids') || ''),
              site: url.searchParams.get('site') || '',
              network: url.searchParams.get('network') || '',
              keywords: url.searchParams.get('keywords') || '',
              allowed_traffic: url.searchParams.get('allowed_traffic') || '',
              channel: url.searchParams.get('channel') || '',
              min_payout: url.searchParams.get('min_payout') || url.searchParams.get('payout_min') || '0',
              friction_max: url.searchParams.get('friction_max') || '',
              whale_threshold: url.searchParams.get('whale_threshold') || ''
            };
          }
          // Build a synthetic search URL to reuse handleSearch
          const q = new URL('https://local/offers/search');
          if (body.network) q.searchParams.set('network', String(body.network));
          if (body.keywords) q.searchParams.set('keywords', String(body.keywords));
          if (body.min_payout) q.searchParams.set('min_payout', String(body.min_payout));
          if (body.allowed_traffic) q.searchParams.set('allowed_traffic', String(body.allowed_traffic));
          if (body.channel) q.searchParams.set('channel', String(body.channel));
          q.searchParams.set('max', String(Math.min(200, Number(body.max || 100))));

          const offers = await handleSearch(q, env, req);
          const ids = String(body.ids || '').split(/[\s,]+/).map((s: string) => s.trim()).filter(Boolean);
          const site = String(body.site || '').trim().toLowerCase();

          let filtered = offers;
          if (ids.length) {
            const set = new Set(ids.map((s: string) => s.toLowerCase()));
            filtered = filtered.filter(o => set.has((o.id || '').toLowerCase()));
          }
          if (site) {
            filtered = filtered.filter(o => (o.url || '').toLowerCase().includes(site));
          }

          const allowed = csv(body.allowed_traffic || '');
          if (body.channel) allowed.push(String(body.channel).toLowerCase());
          const whaleThreshold = Number(body.whale_threshold || 10);
          const scored = filtered.map(o => ({ ...o, _score: scoreOffer(o, { allowed, whaleThreshold }) }))
                                 .sort((a,b) => (b._score ?? 0) - (a._score ?? 0));

          const payload = {
            meta: {
              ids,
              site,
              network: body.network || '',
              keywords: body.keywords || '',
              allowed_traffic: allowed,
              channel: body.channel || '',
              min_payout: Number(body.min_payout || 0),
              whale_threshold: Number.isFinite(whaleThreshold) ? whaleThreshold : 10,
              total_examined: offers.length,
              total_matched: scored.length
            },
            items: scored
          };

          // Fire-and-forget log to KV
          try {
            const key = `log:traits:${Date.now()}:${Math.random().toString(36).slice(2,8)}`;
            ctx.waitUntil(kvPutJSON(env.LOGS, key, payload));
          } catch {}

          return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json', ...okCORS(originHdr) } });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: 'inspect_error', message: e?.message || String(e) }), { status: 500, headers: { 'Content-Type': 'application/json', ...okCORS(originHdr) } });
        }
      }
      if (req.method === "GET" && pathname === "/vault/search") {
        return vaultSearch(req, originHdr);
      }

      // Legacy short redirect routes for live traffic
      if (req.method === "GET" && (pathname === "/sv" || pathname === "/sweeps" || pathname === "/win500")) {
        const ua = req.headers.get("user-agent") || "";
        const url = new URL(req.url);
        const src = url.searchParams.get("src") || url.searchParams.get("utm_source") || "direct";
        const campaign = url.searchParams.get("utm_campaign") || "";
        const tracking = [src, campaign].filter(Boolean).join(":");
        // minimal device sniffing
        const isAndroid = /Android/i.test(ua);
        const isiOS = /iPhone|iPad|iPod/i.test(ua);
        if (isAndroid) {
          return Response.redirect("https://singingfiles.com/show.php?l=0&u=2427730&id=68831&tracking_id=" + encodeURIComponent(tracking), 302);
        }
        if (isiOS) {
          return Response.redirect("https://singingfiles.com/show.php?l=0&u=2427730&id=69234&tracking_id=" + encodeURIComponent(tracking), 302);
        }
        // desktop or unknown => generic fallback
        return Response.redirect(env.FALLBACK_GENERIC || "https://aiqengage.com/access", 302);
      }

      if (req.method === "GET" && pathname === "/offers/search") {
        const url = new URL(req.url);
        // TODO: If you later fetch real upstreams, wrap with safeJson(...)
  const offers = await handleSearch(url, env, req);

        // Split controls and modes
        const split = url.searchParams.get("split") === "true";
        const splitMode = (url.searchParams.get("split_mode") || "traffic").toLowerCase() as "traffic" | "payout";
let frictionMax: number;
const frictionParam = url.searchParams.get("friction_max");
if (frictionParam != null) {
  frictionMax = Number(frictionParam);
} else {
  // Default GREEN threshold: <=7 minutes when split=true; otherwise leave at 6 for legacy compatibility
  frictionMax = split ? 7 : 6;
}
const payoutMin = Number(url.searchParams.get("min_payout") ?? url.searchParams.get("payout_min") ?? 0);
let whaleThreshold = Number(url.searchParams.get("whale_threshold") ?? 10);
if (!Number.isFinite(whaleThreshold) || whaleThreshold <= 0) whaleThreshold = 10;
const allowedMode = (url.searchParams.get("allowed_traffic_mode") ?? "all") as "all" | "any";
const channel = url.searchParams.get("channel")?.trim();
const reqAllowed = csv(url.searchParams.get("allowed_traffic"));
if (channel) reqAllowed.push(channel.toLowerCase());

// Score for ranking and payout split
const scored = offers.map(o => ({ ...o, _score: scoreOffer(o, { allowed: reqAllowed, whaleThreshold }) }));
const applyWhaleFilter = url.searchParams.has("whale_threshold") && whaleThreshold > 0;
if (split) {
  const networks = csv(url.searchParams.get("network"));
  if (splitMode === "payout") {
    const whale_threshold = whaleThreshold;
    const whales = scored.filter(o => (o.payout ?? 0) >= whale_threshold)
                         .sort((a,b) => (b._score ?? 0) - (a._score ?? 0));
    const minnows = scored.filter(o => (o.payout ?? 0) < whale_threshold)
                          .sort((a,b) => (b._score ?? 0) - (a._score ?? 0));

          const meta = {
            geo: url.searchParams.get("geo") ?? "US",
            device: url.searchParams.get("device") ?? "mobile",
            ctype: url.searchParams.get("ctype") ?? "CPA+PIN",
            networks,
            keywords: url.searchParams.get("keywords") ?? "",
            min_payout: payoutMin,
            split_mode: splitMode,
            friction_max: frictionMax,
            allowed_traffic: reqAllowed,
            channel,
            allowed_traffic_mode: allowedMode
          };

          return new Response(JSON.stringify({
            meta,
            whales,
            minnows,
            counts: { whales: whales.length, minnows: minnows.length, total: scored.length },
            rules: { whale_threshold }
          }), { headers: { "Content-Type": "application/json", ...okCORS(originHdr) } });
        }

        const baseList = applyWhaleFilter ? scored.filter(o => (o.payout ?? 0) >= whaleThreshold) : scored;
        const result = splitOffers(baseList, reqAllowed, { frictionMax, payoutMin, allowedMode });
        const resultWithRule = { ...result, rules: { ...result.rules, whale_threshold: applyWhaleFilter ? whaleThreshold : undefined } };

        return new Response(JSON.stringify({ meta: {
            geo: url.searchParams.get("geo") ?? "US",
            device: url.searchParams.get("device") ?? "mobile",
            ctype: url.searchParams.get("ctype") ?? "CPA+PIN",
            networks,
            keywords: url.searchParams.get("keywords") ?? "",
            min_payout: payoutMin,
            split_mode: splitMode,
            friction_max: frictionMax,
            allowed_traffic: reqAllowed,
            channel,
            allowed_traffic_mode: allowedMode
          },
          ...resultWithRule }), {
          headers: { "Content-Type": "application/json", ...okCORS(originHdr) }
        });
      }

      const flatList = (applyWhaleFilter ? scored.filter(o => (o.payout ?? 0) >= whaleThreshold) : scored)
        .map(o => ({ ...o }))
        .sort((a,b) => (b._score ?? 0) - (a._score ?? 0));
      return new Response(JSON.stringify({ offers: flatList }), {
          headers: { "Content-Type": "application/json", ...okCORS(originHdr) }
        });
      }

      if (req.method === "GET" && pathname === "/offers/redirect") {
        const url = new URL(req.url);
        const offerId = url.searchParams.get("offer_id") || "";
        const tracking = url.searchParams.get("tracking_id") || "";
        // Map known fallback offers to safe outbound links (no private keys in query)
        if (offerId === "ogads_us_android_68831") {
          return Response.redirect("https://singingfiles.com/show.php?l=0&u=2427730&id=68831&tracking_id=" + encodeURIComponent(tracking), 302);
        }
        if (offerId === "ogads_us_ios_69234") {
          return Response.redirect("https://singingfiles.com/show.php?l=0&u=2427730&id=69234&tracking_id=" + encodeURIComponent(tracking), 302);
        }
        if (offerId === "cpagrip_us_giftcard_a1") {
          // Replace with a neutral placeholder or your own cloaked link. No pubkey/user_id here.
          return Response.redirect("https://www.cpagrip.com/offer/landing?tracking_id=" + encodeURIComponent(tracking), 302);
        }
        return new Response(JSON.stringify({ error: "unknown_offer" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...okCORS(originHdr) }
        });
      }

      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...okCORS(originHdr) }
      });

    } catch (err: any) {
      console.error("ERR", {
        message: err?.message || String(err),
        stack: err?.stack,
        ray: (req as any).cf?.rayId
      });
      return new Response(JSON.stringify({ error: "server_error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...okCORS(originHdr) }
      });
    }
  }
} as ExportedHandlerShim<Env>;

// ===== Vault UI implementation =====
const VAULT_HTML = (body: string) => `<!doctype html>
<html lang="en"><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Offer Vault</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:24px}
  input,select{padding:6px 8px;margin:4px}
  table{border-collapse:collapse;width:100%;margin-top:16px}
  th,td{border:1px solid #ddd;padding:8px;font-size:14px}
  th{background:#f5f5f5;text-align:left}
  .wrap{max-width:1100px;margin:0 auto}
  .muted{color:#666}
  .hint{font-size:12px;color:#666;margin-left:8px}
  .btn{padding:6px 10px;margin:8px 0;cursor:pointer}
</style>
<div class="wrap">
<h1>Offer Vault</h1>
<form action="/vault/search" method="get">
  <div>
    <label>Geo (CSV)</label>
    <input name="geo" placeholder="US,CA,UK,AU,DE,FR" />
    <label>Device (CSV)</label>
    <input name="device" placeholder="mobile,desktop" />
    <label>Type (CSV or *)</label>
    <input name="ctype" placeholder="CPA,CPI,SOI,DOI,Trial,Deposit" />
  </div>
  <div>
    <label>Networks</label>
    <input name="network" placeholder="ogads,cpagrip" />
    <label>Allowed Traffic</label>
    <input name="allowed_traffic" placeholder="Reddit,TikTok,Pinterest" />
    <label>Channel</label>
    <input name="channel" placeholder="TikTok" />
  </div>
  <div>
    <label>Min Payout</label>
    <input name="min_payout" type="number" step="0.1" min="0" value="0" />
    <label>Max</label>
    <input name="max" type="number" min="1" max="50" value="20" />
    <label><input type="checkbox" name="split" value="true" checked /> Split (GREEN/YELLOW)</label>
    <label>Friction max</label>
    <input name="friction_max" type="number" min="1" max="30" value="7" />
 </div>
 <div>
    <button type="submit">Search</button>
    <span class="muted">Public view — no API key required</span>
  </div>
 </form>
 ${body}
</div>
<script>
// Enhance tables: click-to-sort and simple \"Show all\" for long lists
function setupTable(table){
  if(!table || !table.tHead) return;
  const ths = table.tHead.rows[0].cells;
  for(let i=0;i<ths.length;i++){
    ths[i].style.cursor='pointer';
    ths[i].title='Click to sort';
    ths[i].addEventListener('click',()=>sortTable(table,i,ths[i].dataset.type||'text'));
  }
  const limit = Number(table.dataset.limit || 0);
  if(limit>0 && table.tBodies[0]){
    const rows = Array.from(table.tBodies[0].rows);
    if(rows.length>limit){
      for(let i=limit;i<rows.length;i++) rows[i].style.display='none';
      const btn = table.nextElementSibling;
      if(btn && btn.classList.contains('show-more')){
        btn.style.display='inline-block';
        btn.addEventListener('click',()=>{
          rows.forEach(r=>r.style.display='');
          btn.remove();
        });
      }
    }
  }
}
function sortTable(table,col,type){
  const asc = !(table.dataset.sortCol==String(col) && table.dataset.sortDir==='asc');
  const tbody = table.tBodies[0];
  const rows = Array.from(tbody.rows);
  rows.sort((a,b)=>{
    let va = a.cells[col].textContent.trim();
    let vb = b.cells[col].textContent.trim();
    if(type==='num'){
      const na = parseFloat(va)||0, nb = parseFloat(vb)||0;
      return asc ? na-nb : nb-na;
    }
    return asc ? va.localeCompare(vb) : vb.localeCompare(va);
  });
  rows.forEach(r=>tbody.appendChild(r));
  table.dataset.sortCol=String(col);
  table.dataset.sortDir=asc?'asc':'desc';
}
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('table.sortable').forEach(t=>setupTable(t));
});
</script>
</html>`;

function serveVault(origin?: string) {
  const body = `<p class="muted">Enter filters and submit to view offers. Use split to see GREEN (faster, matched traffic) vs YELLOW.</p>`;
  return new Response(VAULT_HTML(body), { headers: { "Content-Type": "text/html; charset=utf-8", ...okCORS(origin) } });
}

async function vaultSearch(req: Request, origin?: string) {
  const url = new URL(req.url);
  const offers = await handleSearch(url, undefined, req);
  const channel = url.searchParams.get("channel")?.trim();
  const reqAllowed = csv(url.searchParams.get("allowed_traffic"));
  if (channel) reqAllowed.push(channel.toLowerCase());
  const allowedMode = (url.searchParams.get("allowed_traffic_mode") ?? "all") as "all"|"any";
  const scored = offers.map(o => ({ ...o, _score: scoreOffer(o, { allowed: reqAllowed, allowedMode }) }))
                      .sort((a,b) => (b._score ?? 0) - (a._score ?? 0));

  const split = url.searchParams.get("split") === "true";
  const frictionMax = Number(url.searchParams.get("friction_max") ?? 7);

  let body = "";
  if (split) {
    const result = splitOffers(scored, reqAllowed, { frictionMax, payoutMin: Number(url.searchParams.get("min_payout") ?? 0), allowedMode });
    const renderRows = (arr: Offer[]) => arr.map(o => `<tr><td>${o.name}</td><td>${o.network}</td><td>${o.payout ?? ''}</td><td>${(o._score ?? 0).toFixed(3)}</td><td>${(o.geo||[]).join(',')}</td><td>${(o.device||[]).join(',')}</td><td>${o.friction_minutes ?? ''}</td></tr>`).join("");
    body = `
      <h2>GREEN (${result.green.length}) <span class="hint">click headers to sort</span></h2>
      <table id="greenTable" class="sortable" data-limit="20"><thead><tr>
        <th data-type="text">Name</th><th data-type="text">Net</th><th data-type="num">Payout</th><th data-type="num">Score</th><th data-type="text">Geo</th><th data-type="text">Device</th><th data-type="num">Friction</th>
      </tr></thead>
      <tbody>${renderRows(result.green)}</tbody></table>
      <button class="btn show-more" data-target="greenTable" style="display:none">Show all</button>
      <h2>YELLOW (${result.yellow.length}) <span class="hint">click headers to sort</span></h2>
      <table id="yellowTable" class="sortable" data-limit="20"><thead><tr>
        <th data-type="text">Name</th><th data-type="text">Net</th><th data-type="num">Payout</th><th data-type="num">Score</th><th data-type="text">Geo</th><th data-type="text">Device</th><th data-type="num">Friction</th>
      </tr></thead>
      <tbody>${renderRows(result.yellow)}</tbody></table>
      <button class="btn show-more" data-target="yellowTable" style="display:none">Show all</button>
      <p class="muted">Total: ${result.counts.total} • Rules: friction_max=${result.rules.friction_max}, payout_min=${result.rules.payout_min}, allowed_traffic_mode=${result.rules.allowed_traffic_mode}</p>
    `;
  } else {
    const rows = scored.map(o => `<tr><td>${o.name}</td><td>${o.network}</td><td>${o.payout ?? ''}</td><td>${(o._score ?? 0).toFixed(3)}</td><td>${(o.geo||[]).join(',')}</td><td>${(o.device||[]).join(',')}</td><td>${o.friction_minutes ?? ''}</td></tr>`).join("");
    body = `
      <h2>Offers (${scored.length}) <span class=\"hint\">click headers to sort</span></h2>
      <table id="flatTable" class="sortable" data-limit="20"><thead><tr>
        <th data-type="text">Name</th><th data-type="text">Net</th><th data-type="num">Payout</th><th data-type="num">Score</th><th data-type="text">Geo</th><th data-type="text">Device</th><th data-type="num">Friction</th>
      </tr></thead>
      <tbody>${rows}</tbody></table>
      <button class="btn show-more" data-target="flatTable" style="display:none">Show all</button>
    `;
  }
  return new Response(VAULT_HTML(body), { headers: { "Content-Type": "text/html; charset=utf-8", ...okCORS(origin) } });
}

// ===== Admin: Traits Inspector (HTML) =====
function INSPECTOR_HTML(body: string) {
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Traits Inspector</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:24px}
  .wrap{max-width:1100px;margin:0 auto}
  input,textarea,select{padding:6px 8px;margin:4px;width:100%;box-sizing:border-box}
  label{font-weight:600;margin-top:8px;display:block}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .btn{padding:8px 12px;margin:8px 0;cursor:pointer}
  table{border-collapse:collapse;width:100%;margin-top:16px}
  th,td{border:1px solid #ddd;padding:8px;font-size:14px}
  th{background:#f5f5f5;text-align:left}
  .muted{color:#666}
  .grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  .grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
  .controls{background:#fafafa;border:1px solid #eee;padding:12px;border-radius:8px}
  .err{color:#b00}
  .ok{color:#060}
  .pill{display:inline-block;background:#eef;padding:2px 6px;border-radius:10px;font-size:12px;margin-left:8px}
  .hint{font-size:12px;color:#666;margin-left:8px}
  .nowrap{white-space:nowrap}
  .sm{font-size:12px;color:#666}
  .right{text-align:right}
  .mono{font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
  .flex{display:flex;gap:12px;align-items:center}
  .flex>*{flex:1}
  .w-33{flex:0 0 33%}
  .w-50{flex:0 0 50%}
  .w-25{flex:0 0 25%}
  .my8{margin:8px 0}
  .mt16{margin-top:16px}
  .mb8{margin-bottom:8px}
  .center{text-align:center}
  .hidden{display:none}
  .badge{background:#eee;border-radius:6px;padding:2px 6px;font-size:12px;margin-left:6px}
  .head{display:flex;justify-content:space-between;align-items:center}
  .head h1{margin:0}
  .head .links a{margin-left:12px}
  .kvs{font-size:12px;color:#666}
  .s{font-size:12px}
  .nowrap{white-space:nowrap}
  .score{font-weight:700}
  .green{color:#0a0}
  .yellow{color:#aa0}
  .net{font-weight:600}
  .id{font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;font-size:12px}
  .url{max-width:380px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tbl-wrap{overflow:auto}
  .topline{font-size:13px;color:#444}
  .topline code{background:#f5f5f5;border:1px solid #eee;padding:1px 4px;border-radius:4px}
  .small{font-size:12px;color:#555}
  .sep{height:1px;background:#eee;margin:12px 0}
  .caps{font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.08em}
  .toolbar{display:flex;gap:8px;align-items:center}
  .toolbar .btn{margin:0}
  .spacer{flex:1}
  .note{font-size:12px;color:#666}
  .shadow{box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .card{background:#fff;border:1px solid #eee;border-radius:8px;padding:12px}
  .mono-sm{font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px}
  .tag{display:inline-block;border:1px solid #ddd;border-radius:12px;padding:0 8px;line-height:20px;font-size:12px;background:#fafafa;margin-right:6px}
  .counts{font-size:12px;color:#444}
  .counts b{font-weight:700}
  .nowrap{white-space:nowrap}
  .right{ text-align:right }
  .fit{ width:1%; white-space:nowrap }
  .tight td{padding:6px}
  .tight th{padding:6px}
</style>
<div class="wrap">
  <div class="head">
    <h1>Traits Inspector <span class="pill">beta</span></h1>
    <div class="links small"><a href="/vault/search">Offer Vault</a> · <a href="/openapi.json">OpenAPI</a></div>
  </div>
  <p class="topline">Paste deal traits to locate and rank offers. Provide IDs and/or a site substring. Results are logged for assessment.</p>
  <div class="controls card shadow">
    <div class="row">
      <div>
        <label>Deal IDs (CSV or whitespace)</label>
        <textarea id="ids" rows="3" placeholder="id1, id2, id3..."></textarea>
      </div>
      <div>
        <label>Site contains</label>
        <input id="site" placeholder="example.com, unlockcontent.net, ..."/>
        <div class="note">Matches inside the offer tracking URL.</div>
      </div>
    </div>
    <div class="row">
      <div>
        <label>Networks</label>
        <input id="network" placeholder="ogads,cpagrip,mylead,maxbounty"/>
      </div>
      <div>
        <label>Keywords (search in name/vertical)</label>
        <input id="keywords" placeholder="gift card, sweeps, PIN"/>
      </div>
    </div>
    <div class="grid-4">
      <div>
        <label>Allowed Traffic</label>
        <input id="allowed_traffic" placeholder="Reddit,TikTok,Pinterest"/>
      </div>
      <div>
        <label>Channel (alias for single allowed_traffic)</label>
        <input id="channel" placeholder="reddit"/>
      </div>
      <div>
        <label>Min Payout</label>
        <input id="min_payout" type="number" min="0" step="0.01" value="0"/>
      </div>
      <div>
        <label>Whale Threshold</label>
        <input id="whale_threshold" type="number" min="0" step="0.01" value="10"/>
      </div>
    </div>
    <div class="toolbar mt16">
      <button class="btn" id="runBtn">Search & Rank</button>
      <div class="spacer"></div>
      <div id="status" class="small"></div>
    </div>
  </div>

  <div id="out" class="mt16"></div>
</div>
<script>
async function runInspect(){
  const q = {
    ids: document.getElementById('ids').value,
    site: document.getElementById('site').value,
    network: document.getElementById('network').value,
    keywords: document.getElementById('keywords').value,
    allowed_traffic: document.getElementById('allowed_traffic').value,
    channel: document.getElementById('channel').value,
    min_payout: document.getElementById('min_payout').value,
    whale_threshold: document.getElementById('whale_threshold').value
  };
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Running...';
  try{
    const res = await fetch('/offers/admin/inspect', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(q)});
    const data = await res.json();
    statusEl.textContent = res.ok ? 'OK' : ('Error: ' + (data && data.message || res.status));
    if(!res.ok){ document.getElementById('out').innerHTML = '<p class="err">'+(data.message||'Error')+'</p>'; return; }
    const items = data.items||[];
    const head = `<div class="counts">Matched <b>${data.meta.total_matched}</b> of <b>${data.meta.total_examined}</b> examined · Network: <code class="mono-sm">${data.meta.network||'*'}</code> · Allowed: <code class="mono-sm">${(data.meta.allowed_traffic||[]).join(', ')||'*'}</code></div>`;
    const rows = items.map(o=>`<tr>
      <td class="id">${o.id||''}</td>
      <td class="net">${o.network||''}</td>
      <td class="right fit">${o.payout!=null?o.payout:''}</td>
      <td class="right fit score">${(o._score||0).toFixed(3)}</td>
      <td class="url"><a href="${o.url}" target="_blank" rel="noopener">${o.url}</a></td>
      <td class="fit">${(o.geo||[]).join(',')}</td>
      <td class="fit">${(o.device||[]).join(',')}</td>
      <td class="fit">${o.friction_minutes??''}</td>
    </tr>`).join('');
    const table = `<div class="tbl-wrap"><table class="tight"><thead><tr>
      <th>Offer ID</th><th>Net</th><th class="right fit">Payout</th><th class="right fit">Score</th><th>URL</th><th class="fit">Geo</th><th class="fit">Device</th><th class="fit">Friction</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
    document.getElementById('out').innerHTML = `<div class="card shadow">${head}${table}</div>`;
  }catch(e){ statusEl.textContent = 'Error'; document.getElementById('out').innerHTML = '<p class="err">'+e+'</p>'; }
}
document.getElementById('runBtn').addEventListener('click', (e)=>{ e.preventDefault(); runInspect(); });
</script>
</html>`;
}

function serveInspector(origin?: string){
  return new Response(INSPECTOR_HTML(''), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...okCORS(origin) } });
}
