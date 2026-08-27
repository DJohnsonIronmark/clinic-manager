import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

// Service role, server-side: both tables are RLS-locked with no anon policies,
// so the previous anon client returned an empty list (the map showed no
// clinics). Created per request so a missing env var fails the request loudly
// rather than the build.
const db = () => getServiceClient();

// Canonical clinic_id form: strip leading zeros from purely-numeric IDs so
// '05012' and 5012 (bigint) both key to '5012'. Non-numeric IDs pass through
// unchanged. Fixes a bug where Norwalk ('05012' in clinic_territories vs
// 5012 in TJC Locations GeoCoded) failed the merge join and rendered at 0,0.
function normalizeClinicId(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (s === '') return '';
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}

// Fetch all rows by paginating in chunks to bypass 1000 row limit.
// orderBy is required — without a stable sort, Postgres may return rows in
// different orders across paginated calls and silently drop or duplicate rows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllRows(table: string, columns: string, orderBy: string): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRows: any[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await db()
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`${table} error: ${error.message}`);
    if (!data || data.length === 0) break;

    allRows.push(...data);
    if (data.length < pageSize) break; // Last page
    offset += pageSize;
  }

  return allRows;
}

export async function GET() {
  try {
    // Fetch both tables with pagination to get ALL rows
    const [territories, locations] = await Promise.all([
      fetchAllRows('clinic_territories', 'clinic_id,clinic_name,state,city,metro_type', 'clinic_id'),
      fetchAllRows('TJC Locations GeoCoded', 'ClinicID,Name,Address,City,State,latitude,longitude', 'ClinicID'),
    ]);

    console.log('Fetched:', territories.length, 'territories,', locations.length, 'locations');

    // Merge the data - normalize IDs to a canonical form for consistent lookup
    const locById: Record<string, Record<string, unknown>> = {};
    locations.forEach((loc) => {
      const id = normalizeClinicId(loc.ClinicID);
      if (id) locById[id] = loc;
    });

    const merged = territories.map((t) => {
      const id = normalizeClinicId(t.clinic_id);
      const loc = id ? locById[id] : null;
      return {
        clinic_id: id,
        clinic_name: (t.clinic_name || loc?.Name || `Clinic ${id}`) as string,
        state: (t.state || loc?.State) as string,
        city: (t.city || loc?.City) as string,
        address: (loc?.Address || '') as string,
        latitude: parseFloat(String(loc?.latitude ?? 0)),
        longitude: parseFloat(String(loc?.longitude ?? 0)),
        metro_type: (t.metro_type || 'unknown') as string
      };
    });

    return NextResponse.json({ clinics: merged });
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json({ error: 'Internal server error', details: String(error) }, { status: 500 });
  }
}
