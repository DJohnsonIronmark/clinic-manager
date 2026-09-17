import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { APP_ID } from '@/lib/auth';

// Reads live territory data: opt out of Next's Data Cache. Without this, the
// Supabase client's internal fetch is cached and this route serves stale rows
// (a metro_type/geometry change in the DB keeps exporting the old polygon).
// Matches app/api/clinics/route.ts.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('app', APP_ID)
      .single();

    if (error) {
      // No role found for this app
      return NextResponse.json({ role: null });
    }

    return NextResponse.json({ role: data.role });
  } catch (error) {
    console.error('Error fetching user role:', error);
    return NextResponse.json({ role: null });
  }
}
