import { NextRequest, NextResponse } from 'next/server';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY!;

interface GeocodeResult {
  center: [number, number];
  place_name: string;
}

interface IsochroneFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    contour: number;
  };
}

// Geocode an address using Mapbox
async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const encoded = encodeURIComponent(address);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&country=US&limit=1`;

  const response = await fetch(url);
  if (!response.ok) {
    console.error('Geocoding failed:', response.statusText);
    return null;
  }

  const data = await response.json();
  if (!data.features || data.features.length === 0) {
    return null;
  }

  return {
    center: data.features[0].center,
    place_name: data.features[0].place_name
  };
}

// Generate isochrones using Mapbox Isochrone API
async function generateIsochrones(lng: number, lat: number): Promise<IsochroneFeature[] | null> {
  // Generate 10, 15, 20, 30 minute drive-time isochrones
  const minutes = [30, 20, 15, 10];
  const contours = minutes.join(',');

  const url = `https://api.mapbox.com/isochrone/v1/mapbox/driving/${lng},${lat}?contours_minutes=${contours}&polygons=true&access_token=${MAPBOX_TOKEN}`;

  const response = await fetch(url);
  if (!response.ok) {
    console.error('Isochrone generation failed:', response.statusText);
    return null;
  }

  const data = await response.json();
  return data.features || null;
}

// Determine metro type based on population density or default to Suburban
function determineMetroType(state: string, city: string): string {
  // Simple heuristic - could be enhanced with actual population data
  const urbanCities = ['new york', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia', 'san antonio', 'san diego', 'dallas', 'san jose', 'austin', 'jacksonville', 'fort worth', 'columbus', 'charlotte', 'san francisco', 'indianapolis', 'seattle', 'denver', 'boston', 'nashville', 'detroit', 'portland', 'las vegas', 'miami', 'atlanta'];

  const cityLower = city.toLowerCase();
  if (urbanCities.some(uc => cityLower.includes(uc))) {
    return 'Urban';
  }

  // Default to Suburban
  return 'Suburban';
}

// Extract city and state from geocoded address
function extractCityState(placeName: string): { city: string; state: string } {
  const parts = placeName.split(',').map(p => p.trim());
  // Typical format: "123 Main St, City, State ZIP, United States"
  let city = '';
  let state = '';

  if (parts.length >= 3) {
    city = parts[parts.length - 3];
    const stateZip = parts[parts.length - 2];
    state = stateZip.split(' ')[0];
  } else if (parts.length >= 2) {
    city = parts[0];
    state = parts[1].split(' ')[0];
  }

  return { city, state };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clinic_name, clinic_id, address, resolve_overlaps } = body;

    if (!clinic_name || !clinic_id || !address) {
      return NextResponse.json(
        { error: 'clinic_name, clinic_id, and address are required' },
        { status: 400 }
      );
    }

    // Step 1: Geocode the address
    const geocodeResult = await geocodeAddress(address);
    if (!geocodeResult) {
      return NextResponse.json(
        { error: 'Could not geocode address. Please check the address and try again.' },
        { status: 400 }
      );
    }

    const [lng, lat] = geocodeResult.center;
    const { city, state } = extractCityState(geocodeResult.place_name);

    // Step 2: Generate isochrones
    const isochrones = await generateIsochrones(lng, lat);
    if (!isochrones || isochrones.length === 0) {
      return NextResponse.json(
        { error: 'Could not generate drive-time boundaries. Please try again.' },
        { status: 500 }
      );
    }

    // Step 3: Determine metro type and select appropriate isochrone
    const metro_type = determineMetroType(state, city);

    // Create FeatureCollection for raw_geojson (all isochrones)
    const rawGeojson = {
      type: 'FeatureCollection',
      features: isochrones
    };

    // Select the appropriate isochrone based on metro type
    // Index: 0=30min, 1=20min, 2=15min, 3=10min
    const isochroneIndex = metro_type === 'Urban' ? 2 : metro_type === 'Rural' ? 0 : 1;
    const selectedIsochrone = isochrones[isochroneIndex]?.geometry || isochrones[0]?.geometry;

    // Step 4: Check if clinic_id already exists
    const checkResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/clinic_territories?clinic_id=eq.${clinic_id}&select=clinic_id`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        }
      }
    );

    const existing = await checkResponse.json();
    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: `Clinic ID ${clinic_id} already exists` },
        { status: 400 }
      );
    }

    // Step 5: Insert into clinic_territories
    const insertResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/clinic_territories`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          clinic_id,
          clinic_name,
          city,
          state,
          metro_type,
          raw_geojson: rawGeojson
        })
      }
    );

    if (!insertResponse.ok) {
      const errorText = await insertResponse.text();
      console.error('Insert failed:', errorText);
      return NextResponse.json(
        { error: `Failed to create clinic: ${errorText}` },
        { status: 500 }
      );
    }

    // Step 6: Update the geom column with the selected isochrone
    const geomResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/update_clinic_geom`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_clinic_id: clinic_id,
          p_geojson: JSON.stringify(selectedIsochrone)
        })
      }
    );

    if (!geomResponse.ok) {
      console.error('Geom update failed:', await geomResponse.text());
      // Continue anyway - the raw_geojson is saved
    }

    // Step 7: Also insert into TJC Locations GeoCoded table
    const locationResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/TJC Locations GeoCoded`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          ClinicID: clinic_id,
          Name: clinic_name,
          Address: address,
          City: city,
          State: state,
          latitude: lat,
          longitude: lng
        })
      }
    );

    if (!locationResponse.ok) {
      console.error('Location insert warning:', await locationResponse.text());
      // Continue - main record was created
    }

    // Step 8: Resolve overlaps if requested
    if (resolve_overlaps) {
      // This would trigger the overlap resolution logic
      // For now, we'll return a flag indicating overlaps should be checked
    }

    return NextResponse.json({
      success: true,
      clinic: {
        clinic_id,
        clinic_name,
        city,
        state,
        metro_type,
        latitude: lat,
        longitude: lng,
        address: geocodeResult.place_name
      },
      message: `Clinic "${clinic_name}" created successfully with ${metro_type} drive-time boundaries.`
    });

  } catch (error) {
    console.error('Add clinic error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add clinic' },
      { status: 500 }
    );
  }
}
