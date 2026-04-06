import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use anon client for public data - no cookies needed
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

// Fetch all rows by paginating in chunks to bypass 1000 row limit
async function fetchAllRows(table: string, columns: string) {
  const allRows: Record<string, unknown>[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
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
      fetchAllRows('clinic_territories', 'clinic_id,clinic_name,state,city,metro_type'),
      fetchAllRows('TJC Locations GeoCoded', 'ClinicID,Name,Address,City,State,latitude,longitude'),
    ]);

    console.log('Fetched:', territories.length, 'territories,', locations.length, 'locations');

    // Merge the data - convert IDs to strings for consistent lookup
    const locById: Record<string, Record<string, unknown>> = {};
    locations.forEach((loc) => {
      const id = String(loc.ClinicID || '');
      if (id) locById[id] = loc;
    });

    const merged = territories.map((t) => {
      const id = String(t.clinic_id || '');
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
