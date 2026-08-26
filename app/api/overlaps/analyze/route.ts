import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// Overlap summary for a state (or all states). Service-role, server-side:
// clinic_territories is RLS-locked, so the previous direct PostgREST call from
// the browser with the anon key always returned an empty summary.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const state = typeof body.state === 'string' && body.state.trim() ? body.state.trim().slice(0, 64) : null;

    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc('analyze_overlaps', { target_state: state });
    if (error) {
      return NextResponse.json({ error: 'Analyze failed', details: error.message }, { status: 500 });
    }
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json(row ?? { state: state ?? 'ALL', total_overlaps: 0, clinics_with_overlaps: 0 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error', details: String(error) }, { status: 500 });
  }
}
