// Rebuild every clinic territory from its drive-time isochrone, then partition
// overlaps by Voronoi.
//
// Two phases, run in order:
//
//   rebuild  geom = the raw_geojson contour matching metro_type
//            (urban 15-min / suburban 20-min / rural 30-min).
//            This RESETS any prior Voronoi clipping, which is the point:
//            apply_voronoi_cluster only ever intersects, so without a reset a
//            territory can never reclaim ground freed by a closed neighbour.
//
//   voronoi  geom = geom ∩ (that clinic's cell in a single global Voronoi
//            over all clinic points). Each clinic keeps the part of its own
//            drive-time reach that is closer to it than to any other clinic.
//            One global diagram is used rather than per-metro clusters — an
//            under-sized cluster silently leaves overlaps between its members
//            and everyone left out.
//
// Phases go through service_role-only RPCs in small chunks; a single statement
// over ~1,000 rows of isochrone geometry hits statement_timeout (57014).
//
// Run in this order — `voronoi` against a stale cells table silently clips
// every territory to a partition that no longer matches the estate:
//
//   node scripts/rebuild-territories.js --phase cells
//   node scripts/rebuild-territories.js --phase rebuild [--chunk 10]
//   node scripts/rebuild-territories.js --phase voronoi [--chunk 10]
//
// Afterwards, resync geom_3857 (what the map renders) and re-verify:
// zero overlapping pairs, and zero territory area outside its own isochrone.

const fs = require('fs');
const path = require('path');

const ENV_CANDIDATES = [
  path.join(__dirname, '..', '.env.local'),
  '/Users/drewjohnson/clinic-manager/.env.local',
];
for (const p of ENV_CANDIDATES) {
  if (!fs.existsSync(p)) continue;
  fs.readFileSync(p, 'utf-8').split('\n').forEach((line) => {
    const m = line.match(/^([^=#]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
  break;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or service-role key');
  process.exit(1);
}

const args = process.argv.slice(2);
const phase = args.includes('--phase') ? args[args.indexOf('--phase') + 1] : null;
const chunkSize = args.includes('--chunk') ? parseInt(args[args.indexOf('--chunk') + 1], 10) : 20;
if (!['cells', 'rebuild', 'voronoi'].includes(phase)) {
  console.error('--phase must be "cells", "rebuild" or "voronoi"');
  process.exit(1);
}

const RPC = { rebuild: 'rebuild_territory_chunk', voronoi: 'apply_global_voronoi_chunk' }[phase];

// The Voronoi diagram depends only on the set of clinic POINTS, so the cells
// table goes stale the moment a clinic is added or removed. Running `voronoi`
// against stale cells silently clips territories to a partition that no longer
// matches the estate, so always regenerate cells first.
if (phase === 'cells') {
  (async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rebuild_voronoi_cells`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
    console.log(`voronoi cells rebuilt: ${await res.json()}`);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
  return;
}

async function call(fnName, clinicIds, attempt = 0) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clinic_ids: clinicIds }),
  });
  if (res.ok) return res.json();
  const body = await res.text();
  // 57014 = statement timeout. Halve the batch and retry rather than losing the
  // whole chunk; a couple of clinics have unusually dense isochrone geometry.
  if (body.includes('57014') && clinicIds.length > 1 && attempt < 4) {
    const mid = Math.ceil(clinicIds.length / 2);
    const a = await call(fnName, clinicIds.slice(0, mid), attempt + 1);
    const b = await call(fnName, clinicIds.slice(mid), attempt + 1);
    return (a || 0) + (b || 0);
  }
  throw new Error(`${res.status}: ${body.slice(0, 200)}`);
}

(async () => {
  const ids = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/clinic_territories?select=clinic_id&order=clinic_id.asc`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Range: `${offset}-${offset + 999}`,
        },
      }
    );
    const page = await res.json();
    ids.push(...page.map((r) => r.clinic_id));
    if (page.length < 1000) break;
  }

  console.log(`phase=${phase}  clinics=${ids.length}  chunk=${chunkSize}`);
  let affected = 0;
  let failed = 0;
  const errors = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = ids.slice(i, i + chunkSize);
    try {
      affected += (await call(RPC, batch)) || 0;
    } catch (e) {
      failed += batch.length;
      errors.push(e.message);
    }
    process.stdout.write(`\r  ${Math.min(i + chunkSize, ids.length)}/${ids.length}  affected=${affected}`);
  }
  console.log(`\ndone. affected=${affected} failed=${failed}`);
  errors.slice(0, 5).forEach((e) => console.error('  ', e));
  if (failed) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
