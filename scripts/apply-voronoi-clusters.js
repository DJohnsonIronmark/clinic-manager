// Apply Voronoi territory resolution to each connected-component cluster
// from scripts/voronoi-clusters.json. Uses the apply_voronoi_cluster(text[])
// Postgres function via PostgREST RPC.

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
});

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing env: URL or KEY'); process.exit(1); }

const clustersFile = process.env.CLUSTERS_FILE || 'voronoi-clusters.json';
const clusters = JSON.parse(fs.readFileSync(path.join(__dirname, clustersFile), 'utf-8'));
console.log(`Clusters file: ${clustersFile}`);
const start = parseInt(process.argv[2] || '0', 10);
const limit = process.argv[3] ? parseInt(process.argv[3], 10) : clusters.length - start;
const work = clusters.slice(start, start + limit);
console.log(`Processing ${work.length} clusters (start ${start}, limit ${limit})`);

async function applyCluster(clinicIds) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/apply_voronoi_cluster`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clinic_ids: clinicIds }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

(async () => {
  let ok = 0, err = 0, totalAffected = 0;
  const errors = [];
  for (let i = 0; i < work.length; i++) {
    const cluster = work[i];
    const tag = `[${i+1}/${work.length}] size=${cluster.length}`;
    try {
      const affected = await applyCluster(cluster);
      ok++;
      totalAffected += (affected || 0);
      process.stdout.write(`\r${tag} ok (affected=${affected}). total ok=${ok} err=${err}      `);
    } catch (e) {
      err++;
      errors.push({ cluster_index: start + i, size: cluster.length, error: e.message });
      console.error(`\n${tag} ERROR: ${e.message}`);
    }
  }
  console.log(`\n\nDone. ok=${ok} err=${err}. Total clinic geoms updated: ${totalAffected}`);
  if (errors.length) {
    const p = path.join(__dirname, `voronoi-errors-${Date.now()}.json`);
    fs.writeFileSync(p, JSON.stringify(errors, null, 2));
    console.log(`Errors saved: ${p}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
