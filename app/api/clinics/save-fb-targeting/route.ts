import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

interface SaveTargetingRequest {
  clinic_id: string;
  fb_geo_locations: {
    geo_locations?: { custom_locations?: unknown[]; location_types?: string[] };
    excluded_geo_locations?: { custom_locations?: unknown[] };
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: SaveTargetingRequest = await request.json();

    if (!body.clinic_id) {
      return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    }
    if (!body.fb_geo_locations || typeof body.fb_geo_locations !== 'object') {
      return NextResponse.json({ error: 'fb_geo_locations object required' }, { status: 400 });
    }

    const include = body.fb_geo_locations.geo_locations?.custom_locations || [];
    const exclude = body.fb_geo_locations.excluded_geo_locations?.custom_locations || [];
    if (include.length === 0 && exclude.length === 0) {
      return NextResponse.json(
        { error: 'fb_geo_locations must include at least one custom_locations entry' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('clinic_territories')
      .update({ fb_geo_locations: body.fb_geo_locations })
      .eq('clinic_id', body.clinic_id);

    if (error) {
      return NextResponse.json({ error: `Update failed: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      clinic_id: body.clinic_id,
      include_count: include.length,
      exclude_count: exclude.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}
