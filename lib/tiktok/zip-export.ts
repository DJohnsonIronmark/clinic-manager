// TikTok audience ZIP export: every ZIP whose boundary touches a clinic's
// territory or the ring around it.
//
// ZIP boundaries come from the Census TIGERweb ZCTA layer (the same source the
// map's ZIP overlay uses). ZCTAs are the Census approximation of USPS ZIP
// codes — the standard proxy, and what TikTok's US location targeting accepts.

export type ZipExportFormat = 'txt' | 'csv' | 'json';
export const ZIP_EXPORT_FORMATS: ZipExportFormat[] = ['txt', 'csv', 'json'];

export const DEFAULT_BUFFER_MILES = 5;
export const MAX_BUFFER_MILES = 25;

export interface GeoJSONPolygonLike {
  type: string;
  coordinates: unknown;
}

// Esri JSON polygon: an array of rings, each a closed [x, y][] list. Esri
// polygons take multiple rings, so a MultiPolygon's outer rings all go in one
// geometry; holes are dropped (a ZIP touching a hole still touches the ring).
export function geojsonToEsriPolygon(geometry: GeoJSONPolygonLike): { rings: number[][][]; spatialReference: { wkid: 4326 } } {
  const rings: number[][][] = [];
  const trim = (ring: number[][]) => ring.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]);

  if (geometry.type === 'Polygon') {
    const outer = (geometry.coordinates as number[][][])[0];
    if (outer?.length >= 4) rings.push(trim(outer));
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates as number[][][][]) {
      const outer = poly?.[0];
      if (outer?.length >= 4) rings.push(trim(outer));
    }
  } else {
    throw new Error(`Unsupported geometry type: ${geometry.type}`);
  }
  if (rings.length === 0) throw new Error('Geometry has no usable ring');
  return { rings, spatialReference: { wkid: 4326 } };
}

interface TigerFeature { attributes?: { ZCTA5?: string | number | null } }

// Dedupe, validate 5-digit codes, sort ascending.
export function extractZctas(features: TigerFeature[]): string[] {
  const set = new Set<string>();
  for (const f of features) {
    const raw = f?.attributes?.ZCTA5;
    if (raw == null) continue;
    const z = String(raw).trim().padStart(5, '0');
    if (/^\d{5}$/.test(z)) set.add(z);
  }
  return Array.from(set).sort();
}

export function formatZipList(zips: string[], format: ZipExportFormat, meta?: Record<string, unknown>): string {
  switch (format) {
    case 'txt':
      return zips.join('\n') + (zips.length ? '\n' : '');
    case 'csv':
      return 'zip\n' + zips.map((z) => z + '\n').join('');
    case 'json':
      return JSON.stringify({ ...(meta ?? {}), count: zips.length, zips }, null, 2) + '\n';
  }
}

export function contentTypeFor(format: ZipExportFormat): string {
  return format === 'json' ? 'application/json; charset=utf-8'
    : format === 'csv' ? 'text/csv; charset=utf-8'
    : 'text/plain; charset=utf-8';
}

export function exportFilename(clinicName: string | null | undefined, clinicId: string, bufferMiles: number, format: ZipExportFormat): string {
  const base = (clinicName || clinicId).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || clinicId;
  const miles = Number.isInteger(bufferMiles) ? String(bufferMiles) : String(bufferMiles).replace('.', 'p');
  return `${base}_tiktok_zips_${miles}mi.${format}`;
}

export function parseBufferMiles(raw: string | null): number {
  if (raw == null || raw.trim() === '') return DEFAULT_BUFFER_MILES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_BUFFER_MILES;
  return Math.min(n, MAX_BUFFER_MILES);
}

export function parseFormat(raw: string | null): ZipExportFormat {
  const f = (raw || 'txt').toLowerCase();
  return (ZIP_EXPORT_FORMATS as string[]).includes(f) ? (f as ZipExportFormat) : 'txt';
}

// --- I/O -------------------------------------------------------------------

const TIGERWEB_ZCTA_QUERY =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/2/query';

// Every ZCTA intersecting the polygon. POST form body (polygons exceed GET
// URL limits); pages with resultOffset until the server stops flagging
// exceededTransferLimit.
export async function fetchZctasIntersecting(polygon: ReturnType<typeof geojsonToEsriPolygon>): Promise<string[]> {
  const all: TigerFeature[] = [];
  const pageSize = 1000;
  for (let offset = 0, guard = 0; guard < 20; offset += pageSize, guard++) {
    const body = new URLSearchParams({
      geometry: JSON.stringify(polygon),
      geometryType: 'esriGeometryPolygon',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'ZCTA5',
      returnGeometry: 'false',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      f: 'json',
    });
    const res = await fetch(TIGERWEB_ZCTA_QUERY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`TIGERweb HTTP ${res.status}`);
    const data = (await res.json()) as { features?: TigerFeature[]; exceededTransferLimit?: boolean; error?: { message?: string } };
    if (data.error) throw new Error(`TIGERweb: ${data.error.message || 'query error'}`);
    all.push(...(data.features ?? []));
    if (!data.exceededTransferLimit) break;
  }
  return extractZctas(all);
}
