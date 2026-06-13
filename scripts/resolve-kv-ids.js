// scripts/resolve-kv-ids.js
// Called from cf-deploy.yml to resolve (or create) KV namespace IDs
// and patch wrangler.toml in-place before wrangler deploy runs.
const fs = require('fs');

const h = {
  'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
  'Content-Type': 'application/json',
};
const base = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces`;

async function listAll() {
  const r = await fetch(`${base}?per_page=100`, { headers: h });
  const d = await r.json();
  if (!d.success) throw new Error(JSON.stringify(d.errors));
  return d.result;
}

async function resolveId(title) {
  const all = await listAll();
  const existing = all.find(n => n.title === title);
  if (existing) {
    console.log(`  [existing] ${title} => ${existing.id}`);
    return existing.id;
  }
  const r = await fetch(base, { method: 'POST', headers: h, body: JSON.stringify({ title }) });
  const d = await r.json();
  if (!d.success) {
    const retry = (await listAll()).find(n => n.title === title);
    if (retry) return retry.id;
    throw new Error(JSON.stringify(d.errors));
  }
  console.log(`  [created]  ${title} => ${d.result.id}`);
  return d.result.id;
}

(async () => {
  const RATE_LIMIT_KV = await resolveId('rald-event-bus-rate-limit');
  const FLAG_CACHE_KV = await resolveId('rald-event-bus-flag-cache');
  let toml = fs.readFileSync('wrangler.toml', 'utf8');
  toml = toml.replace('REPLACE_WITH_RATE_LIMIT_KV_ID', RATE_LIMIT_KV);
  toml = toml.replace('REPLACE_WITH_FLAG_CACHE_KV_ID', FLAG_CACHE_KV);
  fs.writeFileSync('wrangler.toml', toml);
  console.log('wrangler.toml patched with real KV IDs.');
})().catch(e => { console.error(e); process.exit(1); });
