#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmpDir = path.join(root, 'tmp');
const summaryPath = path.join(tmpDir, 'qa-summary.json');
const offersPath = path.join(tmpDir, 'offers.json');
const reportPath = path.join(root, 'docs', 'qa-report.md');

function redact(k, v){ return /TOKEN|KEY|PASS|SECRET/i.test(k) ? '[redacted]' : v; }

async function main(){
  let summary = {};
  try { summary = JSON.parse(await fs.readFile(summaryPath, 'utf8')); } catch { summary = {}; }
  let offers = [];
  try { offers = JSON.parse(await fs.readFile(offersPath, 'utf8')); } catch {}

  const env = summary.env || {};
  const sync = summary.sync || {};
  const counts = (summary.offers && summary.offers.counts) || {};
  const total = (summary.offers && summary.offers.total) || 0;

  const sample = offers.slice(0, 5).map(o => ({ id:o.id, network:o.network, payout:o.payout, geo:o.geo, url:o.url }));

  const lines = [];
  lines.push(`# AIQBrain Offer Engine — QA Report`);
  lines.push('');
  lines.push('## Environment');
  lines.push(`- WBASE: ${env.WBASE || ''}`);
  lines.push(`- DOMAIN: ${env.DOMAIN || ''}`);
  lines.push(`- LIMIT: ${env.LIMIT || 10}`);
  lines.push('');
  lines.push('## Health');
  lines.push('- Domain: see full-qa output (health-worker.sh)');
  lines.push('- Workers.dev: see full-qa output (health-worker.sh)');
  lines.push('');
  lines.push('## Sync Results');
  const fmtSync = (name, obj) => `- ${name}: fetched=${obj.fetched ?? 'n/a'}, upserted=${obj.upserted ?? 'n/a'}, message=${obj.message ?? 'n/a'}`;
  lines.push(fmtSync('CPAGrip', sync.cpagrip || {}));
  lines.push(fmtSync('MyLead', sync.mylead || {}));
  lines.push('');
  lines.push('## Offers Coverage');
  lines.push(`- Total: ${total}`);
  lines.push(`- CPAGrip: ${counts.CPAGrip ?? 0}`);
  lines.push(`- MyLead: ${counts.MyLead ?? 0}`);
  lines.push(`- MaxBounty: ${counts.MaxBounty ?? 0}`);
  lines.push(`- OGAds: ${counts.OGAds ?? 0}`);
  if (sample.length) {
    lines.push('');
    lines.push('### Sample (first 5)');
    sample.forEach(s => lines.push(`- ${s.id} · ${s.network} · $${s.payout ?? ''} · ${Array.isArray(s.geo)?s.geo.join(','):''} · ${s.url}`));
  }
  lines.push('');
  lines.push('## Filters & Admin');
  lines.push('- Network and geo filter checks are best-effort on /api/offers; see logs for details.');
  lines.push('- CORS and admin upsert checks executed; see logs for statuses.');
  lines.push('');
  lines.push('## HTML Endpoints');
  lines.push('- /admin, /console, /admintemp, /xadmin — see logs for status (200/301/403).');
  lines.push('');
  lines.push('## Unit Tests');
  lines.push('- See tmp/test.out for detailed vitest output.');
  lines.push('');
  if ((counts.CPAGrip ?? 0) === 0 || (counts.MyLead ?? 0) === 0 || (counts.OGAds ?? 0) === 0 || (counts.MaxBounty ?? 0) === 0) {
    lines.push('## Next Steps');
    lines.push('- One or more networks returned zero items. Verify secrets and feature flags, then re-run sync and QA.');
  }

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${reportPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });

