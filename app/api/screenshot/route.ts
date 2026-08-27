import { NextRequest, NextResponse } from 'next/server';
import { getServiceKey } from '@/lib/supabase/service';

interface Clinic {
  clinic_id: string;
  clinic_name: string;
  state: string;
  city: string;
  metro_type: string;
  latitude?: number;
  longitude?: number;
  geojson?: GeoJSON.Geometry;
  raw_geojson?: string;
}

function generateColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = hash % 360;
  // Convert HSL to hex for Mapbox
  return hslToHex(h, 70, 50);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `${f(0)}${f(8)}${f(4)}`;
}

function getGeometry(clinic: Clinic): GeoJSON.Geometry | null {
  if (clinic.geojson) return clinic.geojson;

  if (clinic.raw_geojson) {
    try {
      const parsed = JSON.parse(clinic.raw_geojson);
      if (parsed.type === 'FeatureCollection' && parsed.features?.length) {
        const indices: Record<string, number> = { Urban: 2, Suburban: 1, Rural: 0 };
        const idx = indices[clinic.metro_type] ?? 1;
        return parsed.features[idx]?.geometry || parsed.features[0]?.geometry;
      }
      if (parsed.type === 'Feature') return parsed.geometry;
      if (parsed.coordinates) return parsed;
    } catch {
      return null;
    }
  }

  return null;
}

function simplifyPolygon(coordinates: number[][][], maxPoints: number = 50): number[][][] {
  // Simple polygon simplification - keep every nth point
  return coordinates.map(ring => {
    if (ring.length <= maxPoints) return ring;
    const step = Math.ceil(ring.length / maxPoints);
    const simplified = ring.filter((_, i) => i % step === 0);
    // Ensure the ring is closed
    if (simplified.length > 0 &&
        (simplified[0][0] !== simplified[simplified.length - 1][0] ||
         simplified[0][1] !== simplified[simplified.length - 1][1])) {
      simplified.push(simplified[0]);
    }
    return simplified;
  });
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const clinicIds = searchParams.get('clinics')?.split(',').filter(Boolean) || [];
  const width = parseInt(searchParams.get('width') || '800');
  const height = parseInt(searchParams.get('height') || '600');

  if (clinicIds.length === 0) {
    return NextResponse.json({ error: 'No clinic IDs provided' }, { status: 400 });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SUPABASE_KEY = getServiceKey();
  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

  try {
    // Fetch clinic data
    const clinicFilter = clinicIds.map(id => `clinic_id.eq.${id}`).join(',');
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/clinic_territories?or=(${clinicFilter})&select=clinic_id,clinic_name,state,city,metro_type,geojson,raw_geojson`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch clinic data');
    }

    const clinics: Clinic[] = await response.json();

    // Also fetch coordinates from TJC Locations GeoCoded
    const locationResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/TJC Locations GeoCoded?or=(${clinicIds.map(id => `ClinicID.eq.${id}`).join(',')})&select=ClinicID,latitude,longitude`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    if (locationResponse.ok) {
      const locations: Array<{ ClinicID: string | number; latitude: number; longitude: number }> = await locationResponse.json();
      const locationMap = new Map<string, { lat: number; lng: number }>();

      locations.forEach((l) => {
        locationMap.set(String(l.ClinicID), { lat: l.latitude, lng: l.longitude });
      });

      clinics.forEach(clinic => {
        const loc = locationMap.get(clinic.clinic_id);
        if (loc) {
          clinic.latitude = loc.lat;
          clinic.longitude = loc.lng;
        }
      });
    }

    // Build GeoJSON for Mapbox Static API
    const features: GeoJSON.Feature[] = [];
    const markers: string[] = [];
    let bounds = { minLng: 180, maxLng: -180, minLat: 90, maxLat: -90 };

    clinics.forEach(clinic => {
      const geometry = getGeometry(clinic);
      const color = generateColor(clinic.clinic_id);

      if (geometry && geometry.type === 'Polygon') {
        // Simplify the polygon for the URL
        const simplified = {
          ...geometry,
          coordinates: simplifyPolygon(geometry.coordinates as number[][][], 30),
        };

        features.push({
          type: 'Feature',
          properties: {
            'fill': `#${color}`,
            'fill-opacity': 0.3,
            'stroke': `#${color}`,
            'stroke-width': 2,
          },
          geometry: simplified,
        });

        // Update bounds
        (simplified.coordinates as number[][][]).forEach(ring => {
          ring.forEach(([lng, lat]) => {
            bounds.minLng = Math.min(bounds.minLng, lng);
            bounds.maxLng = Math.max(bounds.maxLng, lng);
            bounds.minLat = Math.min(bounds.minLat, lat);
            bounds.maxLat = Math.max(bounds.maxLat, lat);
          });
        });
      }

      // Add marker for clinic location
      if (clinic.latitude && clinic.longitude) {
        markers.push(`pin-s+${color}(${clinic.longitude},${clinic.latitude})`);
        bounds.minLng = Math.min(bounds.minLng, clinic.longitude);
        bounds.maxLng = Math.max(bounds.maxLng, clinic.longitude);
        bounds.minLat = Math.min(bounds.minLat, clinic.latitude);
        bounds.maxLat = Math.max(bounds.maxLat, clinic.latitude);
      }
    });

    // Calculate center and zoom from bounds
    const centerLng = (bounds.minLng + bounds.maxLng) / 2;
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;

    // Calculate appropriate zoom level
    const lngDiff = bounds.maxLng - bounds.minLng;
    const latDiff = bounds.maxLat - bounds.minLat;
    const maxDiff = Math.max(lngDiff, latDiff);
    let zoom = 10;
    if (maxDiff > 10) zoom = 4;
    else if (maxDiff > 5) zoom = 5;
    else if (maxDiff > 2) zoom = 6;
    else if (maxDiff > 1) zoom = 7;
    else if (maxDiff > 0.5) zoom = 8;
    else if (maxDiff > 0.2) zoom = 9;

    // Build Mapbox Static API URL
    // Note: GeoJSON overlay has URL length limits, so we use markers for simplicity
    // For complex territories, we'll return a link to the interactive map instead

    const geojsonString = encodeURIComponent(JSON.stringify({
      type: 'FeatureCollection',
      features,
    }));

    // Check if URL would be too long (Mapbox limit is ~8000 chars)
    const baseUrl = `https://api.mapbox.com/styles/v1/mapbox/light-v11/static`;
    const geoJsonUrl = `geojson(${geojsonString})`;

    let staticMapUrl: string;

    if (geoJsonUrl.length > 4000) {
      // URL too long - use markers only
      const markerString = markers.join(',');
      staticMapUrl = `${baseUrl}/${markerString}/${centerLng},${centerLat},${zoom}/${width}x${height}@2x?access_token=${MAPBOX_TOKEN}`;
    } else {
      // Include GeoJSON overlay
      staticMapUrl = `${baseUrl}/${geoJsonUrl},${markers.join(',')}/${centerLng},${centerLat},${zoom}/${width}x${height}@2x?access_token=${MAPBOX_TOKEN}`;
    }

    // Fetch the image from Mapbox
    const imageResponse = await fetch(staticMapUrl);

    if (!imageResponse.ok) {
      // If static map fails, return info for interactive map
      const interactiveUrl = `${request.nextUrl.origin}/map?clinics=${clinicIds.join(',')}`;
      return NextResponse.json({
        error: 'Static map generation failed - territories too complex',
        interactive_url: interactiveUrl,
        clinics: clinics.map(c => ({
          clinic_id: c.clinic_id,
          clinic_name: c.clinic_name,
          city: c.city,
          state: c.state,
        })),
      });
    }

    const imageBuffer = await imageResponse.arrayBuffer();

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Screenshot error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate screenshot' },
      { status: 500 }
    );
  }
}
