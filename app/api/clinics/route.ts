import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use anon client for public data - no cookies needed
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

export async function GET() {
  try {

    // Fetch both tables in parallel using SDK (handles pagination automatically)
    const [territoriesResult, locationsResult] = await Promise.all([
      supabase
        .from('clinic_territories')
        .select('clinic_id,clinic_name,state,city,metro_type'),
      supabase
        .from('TJC Locations GeoCoded')
        .select('*'),
    ]);

    if (territoriesResult.error) {
      throw new Error(`Territories error: ${territoriesResult.error.message}`);
    }
    if (locationsResult.error) {
      throw new Error(`Locations error: ${locationsResult.error.message}`);
    }

    const territories = territoriesResult.data || [];
    const locations = locationsResult.data || [];

    // Merge the data - convert IDs to strings for consistent lookup
    const locById: Record<string, Record<string, unknown>> = {};
    locations.forEach((loc: Record<string, unknown>) => {
      const id = String(loc.ClinicID || loc.clinic_id || '');
      if (id) locById[id] = loc;
    });

    const merged = territories.map((t: Record<string, unknown>) => {
      const id = String(t.clinic_id || t.ClinicID || '');
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
