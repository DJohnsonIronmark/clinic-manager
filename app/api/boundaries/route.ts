import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const offset = parseInt(searchParams.get('offset') || '0');
    const limit = parseInt(searchParams.get('limit') || '50');
    const clinicId = searchParams.get('clinic_id');

    let url: string;
    if (clinicId) {
      // Load single clinic boundary
      url = `${SUPABASE_URL}/rest/v1/clinic_territories?select=clinic_id,clinic_name,raw_geojson&clinic_id=eq.${clinicId}`;
    } else {
      // Load batch of boundaries
      url = `${SUPABASE_URL}/rest/v1/clinic_territories?select=clinic_id,clinic_name,raw_geojson&offset=${offset}&limit=${limit}`;
    }

    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'count=exact'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Boundaries API error:', response.status, errorText);
      return NextResponse.json({ error: 'Failed to fetch boundaries', details: errorText }, { status: response.status });
    }

    const contentRange = response.headers.get('content-range');
    const total = contentRange ? parseInt(contentRange.split('/')[1]) : 0;

    const boundaries = await response.json();

    return NextResponse.json({
      boundaries,
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
