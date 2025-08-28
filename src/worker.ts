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
type ExportedHandlerShim<E = Env> = {
  fetch(request: Request, env: E, ctx: ExecutionCtx): Promise<Response>;
};
// src/worker.ts
export interface Env {
  AIQ_API_KEYS?: string; // comma-separated list, e.g. "aiq_dev_test_key_001,another_key"
  // (optional) KV for caching if you want later:
  // AIQ_OFFERS_CACHE: KVNamespace;
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

function scoreOffer(o: Offer, opts: { allowed: string[]; whaleThreshold?: number }): number {
  const payout = logNorm(o.payout ?? 0, 200);
  const epc = logNorm(o.epc ?? 0, 10);
  const tier1 = new Set(["us","ca","uk","au","de","fr"]);
  const geo_match = (o.geo || []).some(g => tier1.has(String(g).toLowerCase())) ? 1 : 0.5;
  const friction = o.friction_minutes ?? 999;
  const friction_bonus = friction <= 7 ? 1 : (friction <= 15 ? 0.5 : 0);
  const traffic_match = opts.allowed.length === 0
    ? 1
    : (o.allowed_traffic || []).map(t => String(t).toLowerCase()).some(t => opts.allowed.includes(t)) ? 1 : 0;

  const isWhale = (o.payout ?? 0) >= (opts.whaleThreshold ?? 10);
  const W = isWhale
    ? { w1:0.5, w2:0.2, w3:0.2, w4:0.05, w5:0.05 }
    : { w1:0.2, w2:0.4, w3:0.2, w4:0.1,  w5:0.1  };

  return (W.w1*payout) + (W.w2*epc) + (W.w3*traffic_match) + (W.w4*geo_match) + (W.w5*friction_bonus);
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

    const isGreen = trafficOK && frictionOK && payoutOK;
    const withTier: Offer = { ...o, tier: isGreen ? "green" : "yellow" };
    (isGreen ? green : yellow).push(withTier);
  }

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

async function handleSearch(url: URL): Promise<Offer[]> {
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
  // Merge by URL to avoid duplicates; prefer registry data over fallbacks
  const mergedMap = new Map<string, Offer>();
  for (const src of [...registryOffers, ...FALLBACK_OFFERS]) {
    const key = (src.url || "") as string;
    if (!key) continue;
    if (!mergedMap.has(key)) mergedMap.set(key, src as Offer);
  }
  let list = Array.from(mergedMap.values());

  if (geos.length) {
    const wanted = geos.map(g => g.toUpperCase());
    list = list.filter(o => anyMatch(o.geo.map(g => g.toUpperCase()), wanted));
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
          { in: "query", name: "split_mode", schema: { type: "string", enum: ["traffic","payout"], default: "traffic" } }
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
        if (accept.includes("application/json")) {
          return new Response(JSON.stringify({ status: "ok" }), {
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
      if (req.method === "GET" && pathname === "/offers/search") {
        const url = new URL(req.url);
        // TODO: If you later fetch real upstreams, wrap with safeJson(...)
        const offers = await handleSearch(url);

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
const allowedMode = (url.searchParams.get("allowed_traffic_mode") ?? "all") as "all" | "any";
const channel = url.searchParams.get("channel")?.trim();
const reqAllowed = csv(url.searchParams.get("allowed_traffic"));
if (channel) reqAllowed.push(channel.toLowerCase());

// Score for ranking and payout split
const scored = offers.map(o => ({ ...o, _score: scoreOffer(o, { allowed: reqAllowed, whaleThreshold: 10 }) }));
if (split) {
  const networks = csv(url.searchParams.get("network"));
  if (splitMode === "payout") {
    const whale_threshold = 10;
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

        const result = splitOffers(scored, reqAllowed, { frictionMax, payoutMin, allowedMode });

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
          ...result }), {
          headers: { "Content-Type": "application/json", ...okCORS(originHdr) }
        });
      }

      return new Response(JSON.stringify({ offers: scored }), {
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
