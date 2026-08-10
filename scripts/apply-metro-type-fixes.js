// Apply metro_type corrections produced by scripts/audit-metro-type.js.
//
// Only rows the audit marked MISMATCH are eligible, and only those whose
// density sits at least --min-margin away from the 1500/sq mi urban threshold.
// Calls within a few percent of the line are close to noise, and flipping them
// churns a clinic's territory (and its Meta targeting radius) for no real gain.
//
// 'rural' is a deliberate manual override for compressed pre-open windows, so
// the audit tags it RURAL_MANUAL and it is never eligible here.
//
//   node scripts/apply-metro-type-fixes.js --csv FILE [--min-margin 0.10] [--apply]
//
// Defaults to a dry run; pass --apply to write.

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

const URBAN_THRESHOLD = 1500;
const args = process.argv.slice(2);
const csvFile = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : null;
const minMargin = args.includes('--min-margin')
  ? parseFloat(args[args.indexOf('--min-margin') + 1])
  : 0.1;
const apply = args.includes('--apply');
if (!csvFile) {
  console.error('--csv is required');
  process.exit(1);
}

// Minimal RFC-4180 parse. Every field the audit writes is quoted, and clinic
// names legitimately contain commas ("Foo, Bar"), so splitting on ',' corrupts
// the row — the same class of bug that broke the TikTok CSV import.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

(async () => {
  const rows = parseCsv(fs.readFileSync(csvFile, 'utf-8'));
  const eligible = rows.filter((r) => {
    if (r.status !== 'MISMATCH') return false;
    const d = parseFloat(r.density);
    if (!Number.isFinite(d)) return false;
    return Math.abs(d - URBAN_THRESHOLD) / URBAN_THRESHOLD >= minMargin;
  });
  const skipped = rows.filter(
    (r) =>
      r.status === 'MISMATCH' &&
      !eligible.includes(r)
  );

  const toUrban = eligible.filter((r) => r.implied === 'urban');
  console.log(`audit rows:        ${rows.length}`);
  console.log(`mismatches:        ${rows.filter((r) => r.status === 'MISMATCH').length}`);
  console.log(`eligible (>=${(minMargin * 100).toFixed(0)}% margin): ${eligible.length}`);
  console.log(`  suburban->urban: ${toUrban.length}`);
  console.log(`  urban->suburban: ${eligible.length - toUrban.length}`);
  console.log(`skipped (near threshold): ${skipped.length}`);

  if (!apply) {
    console.log('\nDRY RUN — no writes. Pass --apply to commit.');
    return;
  }

  let ok = 0;
  const errors = [];
  for (const r of eligible) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/clinic_territories?clinic_id=eq.${encodeURIComponent(r.clinic_id)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ metro_type: r.implied }),
      }
    );
    if (res.ok) ok++;
    else errors.push(`${r.clinic_id}: ${res.status} ${await res.text()}`);
    if ((ok + errors.length) % 50 === 0) process.stdout.write(`\r  ${ok + errors.length}/${eligible.length}`);
  }
  process.stdout.write(`\r  ${ok + errors.length}/${eligible.length}\n`);
  console.log(`updated: ${ok}, errors: ${errors.length}`);
  errors.slice(0, 10).forEach((e) => console.error('  ', e));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
