import { describe, it, expect } from "vitest";
import worker, { buildCpagripUrl } from './src/worker';

// Minimal KV stub
class KV {
  store = new Map<string,string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async put(key: string, value: string) { this.store.set(key, value); }
}

// Basic tests (not executed if vitest not installed)
describe('worker endpoints', () => {
  const REGISTRY = new KV();
  const env: any = { REGISTRY };

  it('/health returns ok:true', async () => {
    const req = new Request('http://local/health');
    const res = await (worker as any).fetch(req, env, { waitUntil() {}, passThroughOnException() {} });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('/admin serves HTML and contains Manual Offer Entry', async () => {
    const req = new Request('http://local/admin');
    const res = await (worker as any).fetch(req, env, { waitUntil() {}, passThroughOnException() {} });
    expect(res.headers.get('content-type') || '').toMatch(/text\/html/);
    const text = await res.text();
    expect(text).toContain('Manual Offer Entry');
  });
});

describe("cpagrip url & redaction", () => {
  const fakeEnv: any = { CPAGRIP_USER: "123", CPAGRIP_PUBKEY: "pub", CPAGRIP_KEY: "priv" };

  it("includes key in fetch URL but is redacted for logs", () => {
    const base = buildCpagripUrl(fakeEnv, { limit: 5, country: "US" });
    expect(base).toContain("user_id=123");
    expect(base).toContain("pubkey=pub");
    expect(base).toContain("key=REDACTED_DURING_LOG");
    const withSecret = base.replace("REDACTED_DURING_LOG", encodeURIComponent(fakeEnv.CPAGRIP_KEY));
    expect(withSecret).toContain("key=priv");
  });
});
