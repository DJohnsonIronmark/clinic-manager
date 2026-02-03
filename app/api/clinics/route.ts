import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;

export async function GET() {
  try {
    // Helper to fetch all rows with pagination (Supabase caps at 1000 per request)
    const fetchAllRows = async (url: string): Promise<Record<string, unknown>[]> => {
      const rows: Record<string, unknown>[] = [];
      let offset = 0;
      const batchSize = 1000;
      while (true) {
        const separator = url.includes('?') ? '&' : '?';
        const res = await fetch(`${url}${separator}offset=${offset}&limit=${batchSize}`, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          },
          cache: 'no-store'
        });
        if (!res.ok) {
          throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
        }
        const batch = await res.json();
        rows.push(...batch);
        if (batch.length < batchSize) break;
        offset += batchSize;
      }
      return rows;
    }

    const [territories, locations] = await Promise.all([
      fetchAllRows(`${SUPABASE_URL}/rest/v1/clinic_territories?select=clinic_id,clinic_name,state,city,metro_type`),
      fetchAllRows(`${SUPABASE_URL}/rest/v1/${encodeURIComponent('TJC Locations GeoCoded')}?select=*`)
    ]);

    // Merge the data
    const locById: Record<string, Record<string, unknown>> = {};
    locations.forEach((loc: Record<string, unknown>) => {
      const id = (loc.ClinicID || loc.clinic_id) as string;
      if (id) locById[id] = loc;
    });

    const merged = territories.map((t: Record<string, unknown>) => {
      const id = (t.clinic_id || t.ClinicID) as string;
      const loc = id ? locById[id] : null;
      return {
        clinic_id: id,
        clinic_name: (t.clinic_name || loc?.Name || `Clinic ${id}`) as string,
        state: (t.state || loc?.State) as string,
        city: (t.city || loc?.City || loc?.city) as string,
        address: (loc?.Address || loc?.address || t.address) as string,
        latitude: parseFloat(String(loc?.Latitude ?? loc?.latitude ?? 0)),
        longitude: parseFloat(String(loc?.Longitude ?? loc?.longitude ?? 0)),
        metro_type: (t.metro_type || 'unknown') as string
      };
    });

    return NextResponse.json({ clinics: merged });
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json({ error: 'Internal server error', details: String(error) }, { status: 500 });
  }
}
