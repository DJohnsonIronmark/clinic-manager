// Pure helpers for the Mapbox isochrone FeatureCollection stored in
// clinic_territories.raw_geojson. No I/O, so they are unit-testable.

export type MetroType = 'urban' | 'suburban' | 'rural';

export interface IsochroneFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: { contour: number; [k: string]: unknown };
}

// Drive-time contour that becomes a clinic's territory. Must match
// rebuild_territory_chunk / get_ring_geometry in the database.
export const CONTOUR_FOR_METRO: Record<MetroType, number> = {
  urban: 15,
  suburban: 20,
  rural: 30,
};

// Contours requested from Mapbox on add, largest first.
export const ISOCHRONE_CONTOURS_MINUTES = [30, 20, 15, 10] as const;

export function normalizeMetroType(value: string | null | undefined): MetroType {
  const v = (value || '').toLowerCase();
  return v === 'urban' || v === 'rural' ? v : 'suburban';
}

// Pick the territory contour by its `contour` property, not by array index —
// index order depends on how the caller built the collection.
export function selectIsochrone(
  features: IsochroneFeature[],
  metroType: string | null | undefined,
): IsochroneFeature | null {
  const wanted = CONTOUR_FOR_METRO[normalizeMetroType(metroType)];
  const exact = features.find((f) => Number(f?.properties?.contour) === wanted);
  if (exact) return exact;
  // Fallback: the largest available contour, so a clinic never ends up with no
  // territory just because one contour is missing from the response.
  return [...features]
    .filter((f) => f?.geometry?.coordinates)
    .sort((a, b) => Number(b.properties?.contour) - Number(a.properties?.contour))[0] ?? null;
}

// Shape stored in clinic_territories.drive_time_rings: an array of Features,
// largest contour first. Same contours as raw_geojson; kept as its own column
// because downstream consumers (Meta push, map presets) read it directly.
export function driveTimeRings(features: IsochroneFeature[]): IsochroneFeature[] {
  return [...features]
    .filter((f) => f?.geometry?.coordinates && f.properties?.contour != null)
    .sort((a, b) => Number(b.properties.contour) - Number(a.properties.contour));
}
