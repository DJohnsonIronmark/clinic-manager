import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectIsochrone,
  driveTimeRings,
  normalizeMetroType,
  type IsochroneFeature,
} from '../lib/territory/isochrones.ts';
import { summarizeCluster, targetingRegenerationIds, type ClusterRow } from '../lib/territory/resolve.ts';

const feat = (contour: number): IsochroneFeature => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, contour], [contour, 0], [0, 0]]] },
  properties: { contour },
});

// Mapbox returns contours largest-first; make sure selection does not depend
// on that order (the old route indexed into the array by position).
const shuffled = [feat(10), feat(30), feat(15), feat(20)];

test('selectIsochrone picks by contour minutes per metro type', () => {
  assert.equal(selectIsochrone(shuffled, 'urban')?.properties.contour, 15);
  assert.equal(selectIsochrone(shuffled, 'suburban')?.properties.contour, 20);
  assert.equal(selectIsochrone(shuffled, 'rural')?.properties.contour, 30);
  assert.equal(selectIsochrone(shuffled, 'SUBURBAN')?.properties.contour, 20);
  assert.equal(selectIsochrone(shuffled, null)?.properties.contour, 20);
});

test('selectIsochrone falls back to the largest contour when the wanted one is missing', () => {
  assert.equal(selectIsochrone([feat(10), feat(15)], 'rural')?.properties.contour, 15);
  assert.equal(selectIsochrone([], 'urban'), null);
});

test('driveTimeRings orders largest contour first and drops malformed features', () => {
  const rings = driveTimeRings([...shuffled, { type: 'Feature', geometry: { type: 'Polygon', coordinates: undefined as never }, properties: { contour: 5 } }]);
  assert.deepEqual(rings.map((r) => r.properties.contour), [30, 20, 15, 10]);
});

test('normalizeMetroType defaults unknown values to suburban', () => {
  assert.equal(normalizeMetroType('Urban'), 'urban');
  assert.equal(normalizeMetroType('anything'), 'suburban');
  assert.equal(normalizeMetroType(undefined), 'suburban');
});

const rows: ClusterRow[] = [
  { clinic_id: '48063', clinic_name: 'Hunt Highway', changed: true, area_before_sq_mi: 133.25, area_after_sq_mi: 32.26 },
  { clinic_id: '48057', clinic_name: 'San Tan Valley', changed: true, area_before_sq_mi: 91.77, area_after_sq_mi: 67.23 },
  { clinic_id: '48064', clinic_name: 'Power Ranch', changed: false, area_before_sq_mi: 24.84, area_after_sq_mi: 24.84 },
];

test('summarizeCluster reports changed vs unchanged members', () => {
  const s = summarizeCluster(rows);
  assert.equal(s.total, 3);
  assert.equal(s.changed.length, 2);
  assert.equal(s.unchanged, 1);
  assert.match(s.message, /2 reshaped/);
  assert.match(s.message, /Hunt Highway 133.25→32.26 sq mi/);
  assert.equal(summarizeCluster([]).message, 'No overlapping territories found.');
});

test('targetingRegenerationIds = seeds ∪ changed members, deduplicated', () => {
  assert.deepEqual(targetingRegenerationIds(rows, ['48063']).sort(), ['48057', '48063']);
  // a seed whose territory did not change still needs targeting (new clinic)
  assert.deepEqual(targetingRegenerationIds(rows, ['48064']).sort(), ['48057', '48063', '48064']);
  assert.deepEqual(targetingRegenerationIds(rows).sort(), ['48057', '48063']);
});
