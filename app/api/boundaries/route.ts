import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const searchParams = request.nextUrl.searchParams;
    const offset = parseInt(searchParams.get('offset') || '0');
    const limit = parseInt(searchParams.get('limit') || '50');
    const clinicId = searchParams.get('clinic_id');

    let query = supabase
      .from('clinic_territories')
      .select('clinic_id,clinic_name,metro_type,geojson', { count: 'exact' });

    if (clinicId) {
      query = query.eq('clinic_id', clinicId);
    } else {
      query = query.range(offset, offset + limit - 1);
    }

    const { data: boundaries, error, count } = await query;

    if (error) {
      console.error('Boundaries API error:', error);
      return NextResponse.json({ error: 'Failed to fetch boundaries', details: error.message }, { status: 500 });
    }

    const total = count || 0;

    return NextResponse.json({
      boundaries: boundaries || [],
      total,
      offset,
      limit,
      hasMore: offset + limit < total
    });
  } catch (error) {
    console.error('Boundaries API error:', error);
    return NextResponse.json({ error: 'Internal server error', details: String(error) }, { status: 500 });
  }
}
