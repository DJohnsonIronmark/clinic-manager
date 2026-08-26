import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase/service';
import {
  contentTypeFor,
  exportFilename,
  fetchZctasIntersecting,
  formatZipList,
  geojsonToEsriPolygon,
  parseBufferMiles,
  parseFormat,
  type GeoJSONPolygonLike,
} from '@/lib/tiktok/zip-export';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/tiktok/zip-export?clinic_id=48063[&buffer_miles=5][&format=txt|csv|json]
//
// ZIP codes for a TikTok location audience: every ZIP whose boundary touches
// the clinic's territory or the ring `buffer_miles` around it. txt (default)
// is one ZIP per line — paste straight into TikTok Ads Manager.
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const clinicId = (params.get('clinic_id') || '').trim();
    if (!clinicId) {
      return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    }
    const bufferMiles = parseBufferMiles(params.get('buffer_miles'));
    const format = parseFormat(params.get('format'));

    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc('territory_buffer_geojson', {
      p_clinic_id: clinicId,
      p_buffer_miles: bufferMiles,
    });
    if (error) {
      return NextResponse.json({ error: 'Territory lookup failed', details: error.message }, { status: 500 });
    }
    if (!data?.geometry) {
      return NextResponse.json({ error: `No territory found for clinic ${clinicId}` }, { status: 404 });
    }

    const polygon = geojsonToEsriPolygon(data.geometry as GeoJSONPolygonLike);
    const zips = await fetchZctasIntersecting(polygon);

    const meta = {
      clinic_id: data.clinic_id,
      clinic_name: data.clinic_name,
      state: data.state,
      buffer_miles: bufferMiles,
      territory_sq_mi: data.territory_sq_mi,
      buffered_sq_mi: data.buffered_sq_mi,
      source: 'Census TIGERweb ZCTA (ACS2023); ZCTAs approximate USPS ZIP codes',
    };
    const bodyText = formatZipList(zips, format, meta);
    const filename = exportFilename(data.clinic_name, clinicId, bufferMiles, format);

    return new NextResponse(bodyText, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(format),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Zip-Count': String(zips.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'ZIP export failed', details: message }, { status: 502 });
  }
}
