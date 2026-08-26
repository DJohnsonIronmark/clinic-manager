import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateFbTargeting } from '../lib/fb-targeting/generate.ts';

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'));

// Golden test: the server-side port must reproduce, byte for byte, what the
// CLI (scripts/generate-fb-targeting.js) produced for Hunt Highway (48063)
// on 2026-08-26 — the spec that was written to production that day.
test('generateFbTargeting reproduces the Hunt Highway CLI output exactly', () => {
  const input = fixture('fb-targeting-input-48063.json');
  const expected = fixture('fb-targeting-output-48063.json');

  const { fb_geo_locations, summary } = generateFbTargeting(input);

  assert.deepEqual(fb_geo_locations.geo_locations, expected.geo_locations);
  assert.deepEqual(fb_geo_locations.excluded_geo_locations, expected.excluded_geo_locations);
  assert.equal(summary.inclusions, 15);
  assert.equal(summary.exclusions, 10);
});

test('clinic location is always the first include pin', () => {
  const input = fixture('fb-targeting-input-48063.json');
  const { fb_geo_locations } = generateFbTargeting(input);
  const first = fb_geo_locations.geo_locations.custom_locations[0];
  assert.equal(first.latitude, input.latitude);
  assert.equal(first.longitude, input.longitude);
});

test('exclusion donut is 4 corners @45mi + 4 cardinals @30mi, then nearest neighbors @1mi', () => {
  const input = fixture('fb-targeting-input-48063.json');
  const { fb_geo_locations } = generateFbTargeting(input);
  const ex = fb_geo_locations.excluded_geo_locations.custom_locations;
  assert.deepEqual(ex.slice(0, 4).map((e) => e.radius), [45, 45, 45, 45]);
  assert.deepEqual(ex.slice(4, 8).map((e) => e.radius), [30, 30, 30, 30]);
  assert.deepEqual(ex.slice(8).map((e) => e.radius), [1, 1]);
  // neighbors are passed nearest-first; the two closest to Hunt Highway
  assert.deepEqual(ex.slice(8).map((e) => e.name), ['San Tan Valley clinic', 'Queen Creek clinic']);
});

test('rejects geometry with no usable ring', () => {
  const input = fixture('fb-targeting-input-48063.json');
  assert.throws(
    () => generateFbTargeting({ ...input, geometry: { type: 'Polygon', coordinates: [[]] } }),
    /No usable polygon ring/,
  );
});
