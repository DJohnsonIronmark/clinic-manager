import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase/service';
import {
  driveTimeRings,
  ISOCHRONE_CONTOURS_MINUTES,
  selectIsochrone,
  type IsochroneFeature,
} from '@/lib/territory/isochrones';
import { resolveTerritoryCluster, summarizeCluster, targetingRegenerationIds } from '@/lib/territory/resolve';
import { regenerateFbTargeting, type RegenResult } from '@/lib/fb-targeting/regenerate';

export const dynamic = 'force-dynamic';
// Two Mapbox calls + an atomic cluster resolution (~0.5 s) + targeting
// generation. Well under this, but the default is too tight for cold starts.
export const maxDuration = 60;

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

interface GeocodeResult {
  center: [number, number];
  place_name: string;
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

// Generate drive-time isochrones using Mapbox Isochrone API
async function generateIsochrones(lng: number, lat: number): Promise<IsochroneFeature[] | null> {
  const contours = ISOCHRONE_CONTOURS_MINUTES.join(',');
  const url = `https://api.mapbox.com/isochrone/v1/mapbox/driving/${lng},${lat}?contours_minutes=${contours}&polygons=true&access_token=${MAPBOX_TOKEN}`;

  const response = await fetch(url);
  if (!response.ok) {
    console.error('Isochrone generation failed:', response.statusText);
    return null;
  }

  const data = await response.json();
  return data.features || null;
}

// Determine metro type based on population density or default to suburban.
// Existing convention in clinic_territories.metro_type is lowercase
// ('urban' | 'suburban' | 'rural') — must match for downstream filters.
function determineMetroType(state: string, city: string): string {
  const urbanCities = ['new york', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia', 'san antonio', 'san diego', 'dallas', 'san jose', 'austin', 'jacksonville', 'fort worth', 'columbus', 'charlotte', 'san francisco', 'indianapolis', 'seattle', 'denver', 'boston', 'nashville', 'detroit', 'portland', 'las vegas', 'miami', 'atlanta'];

  const cityLower = city.toLowerCase();
  if (urbanCities.some(uc => cityLower.includes(uc))) {
    return 'urban';
  }

  return 'suburban';
}

// US state full name → 2-letter code, for "TJC Locations GeoCoded".State
// (clinic_territories.state uses full names; the locations table uses codes).
const STATE_NAME_TO_CODE: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
  'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'District of Columbia': 'DC',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL',
  'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA',
  'Maine': 'ME', 'Maryland': 'MD', 'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN',
  'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR',
  'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT', 'Virginia': 'VA',
  'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY'
};

function stateToCode(state: string): string {
  if (!state) return state;
  if (state.length === 2) return state.toUpperCase();
  return STATE_NAME_TO_CODE[state] || state;
}

// Extract city and state from geocoded address.
// Mapbox place_name: "123 Main St, City, State ZIP, United States"
// Strip the trailing ZIP (5 or ZIP+4) to keep multi-word states intact
// ("Rhode Island", "New York", "North Carolina"), which the previous
// split(' ')[0] truncated to "Rhode" / "New" / "North".
function extractCityState(placeName: string): { city: string; state: string } {
  const parts = placeName.split(',').map(p => p.trim());
  let city = '';
  let stateZip = '';

  if (parts.length >= 3) {
    city = parts[parts.length - 3];
    stateZip = parts[parts.length - 2];
  } else if (parts.length >= 2) {
    city = parts[0];
    stateZip = parts[1];
  }

  const state = stateZip.replace(/\s+\d{5}(-\d{4})?$/, '').trim();
  return { city, state };
}

// Canonical clinic_id form: strip leading zeros from numeric IDs so the
// text column in clinic_territories stays aligned with the bigint ClinicID
// in TJC Locations GeoCoded. Without this, '05012' and 5012 fail to join
// in /api/clinics and the map renders the clinic at 0,0.
function normalizeClinicId(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (s === '') return '';
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}

function targetingSummary(results: RegenResult[]): string {
  const regenerated = results.filter(r => r.status === 'regenerated').map(r => r.clinic_name ?? r.clinic_id);
  const live = results.filter(r => r.status === 'skipped_live_in_meta').map(r => r.clinic_name ?? r.clinic_id);
  const failed = results.filter(r => r.status === 'error').map(r => `${r.clinic_name ?? r.clinic_id} (${r.detail})`);
  const parts: string[] = [];
  if (regenerated.length) parts.push(`Meta targeting generated for ${regenerated.join(', ')}.`);
  if (live.length) parts.push(`NOT regenerated (live in Meta, re-push deliberately): ${live.join(', ')}.`);
  if (failed.length) parts.push(`Targeting failed for ${failed.join('; ')}.`);
  return parts.join(' ');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clinic_name, address } = body;
    const clinic_id = normalizeClinicId(body.clinic_id);
    // Default on: a clinic added without resolution is a clinic that overlaps
    // its neighbors until someone notices. Pass false to skip explicitly.
    const resolveOverlaps = body.resolve_overlaps !== false;

    if (!clinic_name || !clinic_id || !address) {
      return NextResponse.json(
        { error: 'clinic_name, clinic_id, and address are required' },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

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

    // Step 3: Determine metro type and select the territory contour by its
    // `contour` minutes (urban 15 / suburban 20 / rural 30), not array index.
    const metro_type = determineMetroType(state, city);
    const selectedIsochrone = selectIsochrone(isochrones, metro_type);
    if (!selectedIsochrone) {
      return NextResponse.json(
        { error: 'Drive-time response contained no usable polygon.' },
        { status: 500 }
      );
    }

    // Step 4: Check if clinic_id already exists
    const { data: existing, error: existErr } = await supabase
      .from('clinic_territories')
      .select('clinic_id')
      .eq('clinic_id', clinic_id)
      .limit(1);
    if (existErr) {
      return NextResponse.json({ error: `Lookup failed: ${existErr.message}` }, { status: 500 });
    }
    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: `Clinic ID ${clinic_id} already exists` },
        { status: 400 }
      );
    }

    // Step 5: Insert into clinic_territories. drive_time_rings is the same
    // contour set as raw_geojson, stored as an array of Features (largest
    // first) because the Meta push and map presets read it directly.
    const { error: insertErr } = await supabase
      .from('clinic_territories')
      .insert({
        clinic_id,
        clinic_name,
        city,
        state,
        metro_type,
        raw_geojson: { type: 'FeatureCollection', features: isochrones },
        drive_time_rings: driveTimeRings(isochrones),
      });
    if (insertErr) {
      console.error('Insert failed:', insertErr.message);
      return NextResponse.json(
        { error: `Failed to create clinic: ${insertErr.message}` },
        { status: 500 }
      );
    }

    // Step 6: Set the geom column to the selected isochrone. The geojson column
    // is generated from geom, so this is what the map renders.
    const { error: geomErr } = await supabase.rpc('update_clinic_geom', {
      p_clinic_id: clinic_id,
      p_geojson: JSON.stringify(selectedIsochrone.geometry),
    });
    if (geomErr) {
      console.error('Geom update failed:', geomErr.message);
      return NextResponse.json(
        {
          error: `Clinic row created but territory geometry failed: ${geomErr.message}. Re-run "Rebuild" for clinic ${clinic_id}.`,
          clinic_created: true,
          clinic_id,
        },
        { status: 500 }
      );
    }

    // Step 7: Insert into TJC Locations GeoCoded. Required, not optional: the
    // Voronoi cell used for overlap resolution is computed from this point.
    const { error: locErr } = await supabase
      .from('TJC Locations GeoCoded')
      .insert({
        ClinicID: clinic_id,
        Name: clinic_name,
        Address: address,
        City: city,
        State: stateToCode(state),
        latitude: lat,
        longitude: lng,
      });
    if (locErr) {
      console.error('Location insert failed:', locErr.message);
      return NextResponse.json(
        {
          error: `Clinic territory created but location row failed: ${locErr.message}. Overlaps were NOT resolved.`,
          clinic_created: true,
          clinic_id,
        },
        { status: 500 }
      );
    }

    const clinic = {
      clinic_id,
      clinic_name,
      city,
      state,
      metro_type,
      latitude: lat,
      longitude: lng,
      address: geocodeResult.place_name,
    };

    if (!resolveOverlaps) {
      return NextResponse.json({
        success: true,
        clinic,
        overlaps: null,
        targeting: [],
        message: `Clinic "${clinic_name}" created with ${metro_type} drive-time boundaries. Overlap resolution skipped by request.`,
      });
    }

    // Step 8: Resolve overlaps for this clinic's cluster — atomic, scoped to
    // the new clinic plus everyone it really overlaps. A failure here is a
    // failure of the add: the clinic exists but its territory is wrong, and
    // the response says so instead of reporting success.
    let cluster;
    try {
      cluster = await resolveTerritoryCluster(supabase, { seedIds: [clinic_id] });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error('Overlap resolution failed:', detail);
      return NextResponse.json(
        {
          error: `Clinic "${clinic_name}" was created, but overlap resolution failed: ${detail}. Use Analyze/Resolve Overlaps for ${state} to retry.`,
          clinic_created: true,
          clinic,
        },
        { status: 502 }
      );
    }
    const overlaps = summarizeCluster(cluster);

    // Step 9: Regenerate Meta targeting for the new clinic and every neighbor
    // whose territory changed. Derivative of the territory, so a failure here
    // is reported but does not fail the add.
    let targeting: RegenResult[] = [];
    let targetingError: string | null = null;
    try {
      targeting = await regenerateFbTargeting(supabase, targetingRegenerationIds(cluster, [clinic_id]));
    } catch (e) {
      targetingError = e instanceof Error ? e.message : String(e);
      console.error('Targeting regeneration failed:', targetingError);
    }

    const messageParts = [
      `Clinic "${clinic_name}" created with ${metro_type} drive-time boundaries.`,
      overlaps.message,
      targetingSummary(targeting),
      targetingError ? `Targeting generation failed: ${targetingError}.` : '',
    ].filter(Boolean);

    return NextResponse.json({
      success: true,
      clinic,
      overlaps: {
        total: overlaps.total,
        changed: overlaps.changed.length,
        cluster,
      },
      targeting,
      targeting_error: targetingError,
      message: messageParts.join(' '),
    });

  } catch (error) {
    console.error('Add clinic error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add clinic' },
      { status: 500 }
    );
  }
}
