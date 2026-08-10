// Audit clinic_territories.metro_type against Census 2020 population density.
//
// metro_type selects the drive-time isochrone that becomes the territory
// (urban 15-min / suburban 20-min / rural 30-min), so a wrong tag is a wrong
// territory and a wrong Meta targeting radius.
//
// The /api/clinics/add default (determineMetroType) only matches the city name
// against a hardcoded ~26-city list and otherwise returns 'suburban', so dense
// suburbs are systematically under-tagged. This recomputes from Census truth.
//
// Method (no API key required; api.census.gov ACS needs one, TIGERweb does not):
//   TIGERweb Tracts_Blocks/MapServer/10 = Census 2020 tracts, carrying
//   POP100 / AREALAND / UR. Take all tracts intersecting a 3-mile buffer of the
//   clinic and compute pop-weighted density = ΣPOP100 / Σ(AREALAND) in sq mi.
//
// Classification: density is the PRIMARY test (>1500/sq mi => urban). UR is a
// sanity check only — a 3-mile buffer at any metro edge picks up a few UR='R'
// tracts, so requiring every tract to be 'U' misclassifies obviously-urban
// sites (College Park at 5,019/sq mi, York Road at 5,209).
//
// Read-only: writes a CSV, never touches the database.
//
//   node scripts/audit-metro-type.js [--out FILE] [--limit N]

const fs = require('fs');
const path = require('path');

// .env.local is gitignored, so a git worktree checkout won't have one. Fall
// back to the main repo's copy so this runs from either location.
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

const URBAN_THRESHOLD = 1500; // people per sq mi, pop-weighted over 3 mi
const SQ_M_PER_SQ_MI = 2589988.11;
const CONCURRENCY = 6;

const args = process.argv.slice(2);
const outFile = args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : path.join(__dirname, 'metro-type-audit.csv');
const limit = args.includes('--limit')
  ? parseInt(args[args.indexOf('--limit') + 1], 10)
  : Infinity;

async function fetchAll(table, columns) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url =
      `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}` +
      `?select=${columns}&order=${columns.split(',')[0]}.asc`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Range: `${offset}-${offset + 999}`,
      },
    });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

// Strip leading zeros so '05012' and 5012 key the same (same normalisation the
// clinics API uses — a mismatch here silently drops the clinic's coordinates).
const normId = (v) => {
  const s = String(v ?? '').trim();
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
};

const TIGER =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/10/query';

async function density(lat, lon, attempt = 0) {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    distance: '4828', // 3 miles in metres
    units: 'esriSRUnit_Meter',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'GEOID,POP100,AREALAND,UR',
    returnGeometry: 'false',
    f: 'json',
  });
  try {
    const res = await fetch(`${TIGER}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'tigerweb error');
    const feats = data.features || [];
    if (!feats.length) return null;
    const num = (v) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    let pop = 0;
    let land = 0;
    let nonUrban = 0;
    for (const f of feats) {
      pop += num(f.attributes.POP100);
      land += num(f.attributes.AREALAND);
      if (String(f.attributes.UR) !== 'U') nonUrban++;
    }
    const sqmi = land / SQ_M_PER_SQ_MI;
    if (!sqmi) return null;
    return { density: pop / sqmi, tracts: feats.length, nonUrban, pop };
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      return density(lat, lon, attempt + 1);
    }
    return { error: e.message };
  }
}

(async () => {
  const [territories, locations] = await Promise.all([
    fetchAll('clinic_territories', 'clinic_id,clinic_name,state,city,metro_type'),
    fetchAll('TJC Locations GeoCoded', 'ClinicID,latitude,longitude'),
  ]);

  const locById = {};
  for (const l of locations) locById[normId(l.ClinicID)] = l;

  const work = territories
    .map((t) => ({ ...t, loc: locById[normId(t.clinic_id)] }))
    .slice(0, limit);

  console.log(
    `${territories.length} territories, ${locations.length} geocoded; auditing ${work.length}`
  );

  const results = [];
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < work.length) {
      const c = work[cursor++];
      const lat = parseFloat(c.loc?.latitude);
      const lon = parseFloat(c.loc?.longitude);
      let row = {
        clinic_id: c.clinic_id,
        clinic_name: c.clinic_name,
        state: c.state,
        city: c.city,
        current: c.metro_type,
        density: '',
        tracts: '',
        non_urban: '',
        implied: '',
        status: '',
      };
      // 0,0 is the known "missing geocode" sentinel — it lands off Africa and
      // would return no tracts, so skip rather than record a bogus density.
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
        row.status = 'NO_COORDS';
      } else {
        const d = await density(lat, lon);
        if (!d || d.error) {
          row.status = 'CENSUS_FAIL';
        } else {
          const implied = d.density > URBAN_THRESHOLD ? 'urban' : 'suburban';
          row.density = Math.round(d.density);
          row.tracts = d.tracts;
          row.non_urban = d.nonUrban;
          row.implied = implied;
          // 'rural' is a deliberate manual override (compressed pre-open), not
          // something density should silently undo — flag, never auto-change.
          if (c.metro_type === 'rural') row.status = 'RURAL_MANUAL';
          else row.status = implied === c.metro_type ? 'OK' : 'MISMATCH';
        }
      }
      results.push(row);
      if (++done % 100 === 0) process.stdout.write(`\r  ${done}/${work.length}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write(`\r  ${done}/${work.length}\n`);

  results.sort((a, b) => String(a.clinic_id).localeCompare(String(b.clinic_id)));
  const cols = Object.keys(results[0]);
  const csv = [
    cols.join(','),
    ...results.map((r) =>
      cols.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(',')
    ),
  ].join('\n');
  fs.writeFileSync(outFile, csv);

  const tally = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  console.log('\nStatus:', tally);
  const mism = results.filter((r) => r.status === 'MISMATCH');
  const up = mism.filter((r) => r.implied === 'urban').length;
  console.log(`Mismatches: ${mism.length}  (suburban->urban ${up}, urban->suburban ${mism.length - up})`);
  console.log(`CSV: ${outFile}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
