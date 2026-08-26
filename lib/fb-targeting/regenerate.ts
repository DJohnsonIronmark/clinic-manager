import type { SupabaseClient } from '@supabase/supabase-js';
import { generateFbTargeting, haversineMiles, type NeighborInput } from './generate';

export type RegenStatus =
  | 'regenerated'
  | 'skipped_live_in_meta'
  | 'skipped_no_geometry'
  | 'skipped_no_location'
  | 'error';

export interface RegenResult {
  clinic_id: string;
  clinic_name: string | null;
  status: RegenStatus;
  include_count?: number;
  exclude_count?: number;
  detail?: string;
}

interface TerritoryRow {
  clinic_id: string;
  clinic_name: string | null;
  metro_type: string | null;
  geojson: { type: string; coordinates: unknown } | null;
  meta_last_targeting_push: string | null;
}

interface LocationRow {
  ClinicID: number | string;
  Name: string | null;
  latitude: number | null;
  longitude: number | null;
}

// Neighbors the generator may exclude: nearest first, within this box.
const NEIGHBOR_BOX_DEG = 0.35; // ≈ 24 mi of latitude; generator keeps ≤ 15 mi

// Regenerates clinic_territories.fb_geo_locations from the current territory
// polygon for each clinic id.
//
// Clinics whose targeting has already been pushed to Meta
// (meta_last_targeting_push set) are skipped unless overwriteLive is true: a
// changed territory there means a live ad set is now stale, and re-pushing is a
// deliberate, human-confirmed action — regenerating the stored spec silently
// would hide that. They are reported as skipped_live_in_meta so the caller can
// surface them.
export async function regenerateFbTargeting(
  supabase: SupabaseClient,
  clinicIds: string[],
  opts: { overwriteLive?: boolean } = {},
): Promise<RegenResult[]> {
  if (clinicIds.length === 0) return [];

  const { data: territories, error: tErr } = await supabase
    .from('clinic_territories')
    .select('clinic_id, clinic_name, metro_type, geojson, meta_last_targeting_push')
    .in('clinic_id', clinicIds);
  if (tErr) throw new Error(`load territories: ${tErr.message}`);

  const { data: selfLocs, error: lErr } = await supabase
    .from('TJC Locations GeoCoded')
    .select('ClinicID, Name, latitude, longitude')
    .in('ClinicID', clinicIds);
  if (lErr) throw new Error(`load locations: ${lErr.message}`);
  const locById = new Map<string, LocationRow>();
  for (const l of (selfLocs ?? []) as LocationRow[]) locById.set(String(l.ClinicID), l);

  const results: RegenResult[] = [];
  for (const t of (territories ?? []) as TerritoryRow[]) {
    const base = { clinic_id: t.clinic_id, clinic_name: t.clinic_name };
    if (t.meta_last_targeting_push && !opts.overwriteLive) {
      results.push({ ...base, status: 'skipped_live_in_meta', detail: 'targeting is live in Meta; re-push deliberately' });
      continue;
    }
    if (!t.geojson?.coordinates) {
      results.push({ ...base, status: 'skipped_no_geometry' });
      continue;
    }
    const loc = locById.get(t.clinic_id);
    if (!loc || loc.latitude == null || loc.longitude == null) {
      results.push({ ...base, status: 'skipped_no_location' });
      continue;
    }

    try {
      const neighbors = await loadNeighbors(supabase, t.clinic_id, loc.latitude, loc.longitude);
      const { fb_geo_locations } = generateFbTargeting({
        clinic_id: t.clinic_id,
        clinic_name: t.clinic_name ?? loc.Name ?? t.clinic_id,
        metro_type: t.metro_type,
        latitude: loc.latitude,
        longitude: loc.longitude,
        neighbors,
        geometry: t.geojson,
      });

      const { error: uErr } = await supabase
        .from('clinic_territories')
        .update({ fb_geo_locations })
        .eq('clinic_id', t.clinic_id);
      if (uErr) throw new Error(uErr.message);

      results.push({
        ...base,
        status: 'regenerated',
        include_count: fb_geo_locations.geo_locations.custom_locations.length,
        exclude_count: fb_geo_locations.excluded_geo_locations.custom_locations.length,
      });
    } catch (e) {
      results.push({ ...base, status: 'error', detail: e instanceof Error ? e.message : String(e) });
    }
  }

  // Ids with no territory row at all.
  const seen = new Set(results.map((r) => r.clinic_id));
  for (const id of clinicIds) {
    if (!seen.has(id)) results.push({ clinic_id: id, clinic_name: null, status: 'skipped_no_geometry', detail: 'no clinic_territories row' });
  }
  return results;
}

async function loadNeighbors(
  supabase: SupabaseClient,
  clinicId: string,
  lat: number,
  lng: number,
): Promise<NeighborInput[]> {
  const { data, error } = await supabase
    .from('TJC Locations GeoCoded')
    .select('ClinicID, Name, latitude, longitude')
    .gte('latitude', lat - NEIGHBOR_BOX_DEG)
    .lte('latitude', lat + NEIGHBOR_BOX_DEG)
    .gte('longitude', lng - NEIGHBOR_BOX_DEG)
    .lte('longitude', lng + NEIGHBOR_BOX_DEG);
  if (error) throw new Error(`load neighbors: ${error.message}`);

  return ((data ?? []) as LocationRow[])
    .filter((l) => String(l.ClinicID) !== clinicId && l.latitude != null && l.longitude != null && l.Name)
    .map((l) => ({
      clinic_name: l.Name as string,
      latitude: l.latitude as number,
      longitude: l.longitude as number,
      _d: haversineMiles(lat, lng, l.latitude as number, l.longitude as number),
    }))
    .sort((a, b) => a._d - b._d)
    .map(({ clinic_name, latitude, longitude }) => ({ clinic_name, latitude, longitude }));
}
