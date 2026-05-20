// Regenerate raw_geojson for legacy clinics with new [10,15,20,30] Mapbox isochrone contours.
//
// Reads scripts/legacy-clinics-to-regen.json (clinic_id, lat, lng list pre-computed via MCP).
// For each clinic: hits Mapbox isochrone API, builds FeatureCollection matching
// /api/clinics/add output, then UPDATE clinic_territories SET raw_geojson via PostgREST.
//
// Idempotent: rerun safely; skips clinics already on the new contour set.
// fb_geo_locations, metro_type, and all Meta/FB push columns are NOT touched.
//
// Usage:
//   node scripts/regenerate-legacy-rings.js          # full run (527)
//   node scripts/regenerate-legacy-rings.js 5        # pilot first 5
//   node scripts/regenerate-legacy-rings.js 5 100    # process 100 starting at index 5

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
});

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.MAPBOX_TOKEN;

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_KEY, MAPBOX_TOKEN })) {
  if (!v) { console.error(`Missing env: ${k}`); process.exit(1); }
}

const SR_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

const inputFile = process.env.REGEN_INPUT || 'legacy-clinics-to-regen.json';
const clinics = JSON.parse(fs.readFileSync(path.join(__dirname, inputFile), 'utf-8'));
console.log(`Input: ${inputFile} (${clinics.length} clinics)`);

const offset = parseInt(process.argv[3] || '0', 10);
const limit  = process.argv[2] ? parseInt(process.argv[2], 10) : clinics.length - offset;
const work = clinics.slice(offset, offset + limit);

const RATE_DELAY_MS = 250; // ~4 req/s — well under Mapbox limits

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchIsochrones(lng, lat) {
  const url = `https://api.mapbox.com/isochrone/v1/mapbox/driving/${lng},${lat}?contours_minutes=30,20,15,10&polygons=true&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data.features || data.features.length === 0) throw new Error('No features returned');
  return data.features;
}

async function updateRawGeojson(clinic_id, features) {
  const rawGeojson = { type: 'FeatureCollection', features };
  const url = `${SUPABASE_URL}/rest/v1/clinic_territories?clinic_id=eq.${encodeURIComponent(clinic_id)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: SR_HEADERS,
    body: JSON.stringify({ raw_geojson: rawGeojson, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function alreadyMigrated(clinic_id) {
  // Quick check via PostgREST: pull just the first feature's contour
  const url = `${SUPABASE_URL}/rest/v1/clinic_territories?clinic_id=eq.${encodeURIComponent(clinic_id)}&select=raw_geojson`;
  const res = await fetch(url, { headers: SR_HEADERS });
  if (!res.ok) return false;
  const [row] = await res.json();
  try {
    const rg = typeof row.raw_geojson === 'string' ? JSON.parse(row.raw_geojson) : row.raw_geojson;
    const c = rg?.features?.[0]?.properties?.contour;
    return c === 30 || c === '30';
  } catch { return false; }
}

(async () => {
  console.log(`Processing ${work.length} clinics (offset ${offset}, limit ${limit})`);
  let ok = 0, skip = 0, err = 0;
  const errors = [];

  for (let i = 0; i < work.length; i++) {
    const c = work[i];
    const tag = `[${i+1}/${work.length}] ${c.clinic_id} ${c.clinic_name}`;
    try {
      if (await alreadyMigrated(c.clinic_id)) {
        skip++;
        process.stdout.write(`\r${tag} skip (already migrated). ok=${ok} skip=${skip} err=${err}     `);
        continue;
      }
      const features = await fetchIsochrones(c.longitude, c.latitude);
      await updateRawGeojson(c.clinic_id, features);
      ok++;
      process.stdout.write(`\r${tag} ok. ok=${ok} skip=${skip} err=${err}     `);
    } catch (e) {
      err++;
      errors.push({ clinic_id: c.clinic_id, clinic_name: c.clinic_name, error: e.message });
      console.error(`\n${tag} ERROR: ${e.message}`);
    }
    await sleep(RATE_DELAY_MS);
  }

  console.log(`\n\nDone. ok=${ok} skip=${skip} err=${err} of ${work.length}`);
  if (errors.length) {
    const errPath = path.join(__dirname, `regenerate-legacy-rings-errors-${Date.now()}.json`);
    fs.writeFileSync(errPath, JSON.stringify(errors, null, 2));
    console.log(`Errors saved to ${errPath}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
