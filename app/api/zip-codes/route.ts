import { NextRequest, NextResponse } from 'next/server';

interface ZipCodeFeature {
  attributes: {
    ZCTA5?: string;
    GEOID?: string;
    NAME?: string;
  };
}

interface TigerWebResponse {
  features?: ZipCodeFeature[];
  error?: { message: string; code?: number };
}

// Calculate bounding box from GeoJSON geometry
function getBoundingBox(geometry: GeoJSON.Geometry): { xmin: number; ymin: number; xmax: number; ymax: number } | null {
  let coords: number[][] = [];

  if (geometry.type === 'Polygon') {
    coords = geometry.coordinates.flat();
  } else if (geometry.type === 'MultiPolygon') {
    coords = geometry.coordinates.flat(2);
  } else {
    return null;
  }

  if (coords.length === 0) return null;

  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;

  for (const [lng, lat] of coords) {
    xmin = Math.min(xmin, lng);
    xmax = Math.max(xmax, lng);
    ymin = Math.min(ymin, lat);
    ymax = Math.max(ymax, lat);
  }

  return { xmin, ymin, xmax, ymax };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { geometry } = body;

    if (!geometry) {
      return NextResponse.json({ error: 'Geometry is required' }, { status: 400 });
    }

    // Get bounding box from the polygon
    const bbox = getBoundingBox(geometry);
    if (!bbox) {
      return NextResponse.json({ zipCodes: [] });
    }

    // Query TIGERweb using envelope/bounding box with JSON geometry format
    const envelopeGeometry = JSON.stringify({
      xmin: bbox.xmin,
      ymin: bbox.ymin,
      xmax: bbox.xmax,
      ymax: bbox.ymax,
    });

    const params = new URLSearchParams({
      geometry: envelopeGeometry,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'ZCTA5',
      returnGeometry: 'false',
      f: 'json',
    });

    const tigerWebUrl = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/2/query?${params}`;

    const response = await fetch(tigerWebUrl, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('TIGERweb error:', response.status, response.statusText);
      return NextResponse.json({ zipCodes: [], error: 'Failed to query zip codes' });
    }

    const data: TigerWebResponse = await response.json();

    if (data.error) {
      console.error('TIGERweb API error:', data.error);
      return NextResponse.json({ zipCodes: [], error: data.error.message });
    }

    // Extract zip codes from response
    const zipCodes = (data.features || [])
      .map(f => f.attributes.ZCTA5 || f.attributes.GEOID)
      .filter((z): z is string => !!z && /^\d{5}$/.test(z))
      .sort();

    // Remove duplicates
    const uniqueZipCodes = Array.from(new Set(zipCodes));

    return NextResponse.json({ zipCodes: uniqueZipCodes });
  } catch (error) {
    console.error('Zip code lookup error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to lookup zip codes', zipCodes: [] },
      { status: 500 }
    );
  }
}
