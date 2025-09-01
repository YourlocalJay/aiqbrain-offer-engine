import worker from './src/worker';

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

