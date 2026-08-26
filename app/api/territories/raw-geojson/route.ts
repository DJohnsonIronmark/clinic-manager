import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// Returns a clinic's raw_geojson (all drive-time isochrones). Service-role,
// server-side: clinic_territories is RLS-locked, so this must not run from the
// browser with a privileged key. Replaces the old direct PostgREST call.
export async function GET(request: NextRequest) {
  try {
    const clinicId = request.nextUrl.searchParams.get('clinic_id');
    if (!clinicId) {
      return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('clinic_territories')
      .select('raw_geojson')
      .eq('clinic_id', clinicId);

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch isochrones', details: error.message }, { status: 500 });
    }
    return NextResponse.json(data || []);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error', details: String(error) }, { status: 500 });
  }
}
