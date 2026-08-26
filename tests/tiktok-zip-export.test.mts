import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  geojsonToEsriPolygon,
  extractZctas,
  formatZipList,
  exportFilename,
  parseBufferMiles,
  parseFormat,
} from '../lib/tiktok/zip-export.ts';

const square = [[-111.7, 33.1], [-111.7, 33.26], [-111.48, 33.26], [-111.48, 33.1], [-111.7, 33.1]];

test('geojsonToEsriPolygon converts Polygon outer ring and drops holes', () => {
  const hole = [[-111.6, 33.15], [-111.6, 33.2], [-111.55, 33.2], [-111.55, 33.15], [-111.6, 33.15]];
  const esri = geojsonToEsriPolygon({ type: 'Polygon', coordinates: [square, hole] });
  assert.equal(esri.rings.length, 1);
  assert.deepEqual(esri.rings[0], square);
  assert.deepEqual(esri.spatialReference, { wkid: 4326 });
});

test('geojsonToEsriPolygon puts every MultiPolygon outer ring in one geometry', () => {
  const other = square.map(([x, y]) => [x + 1, y]);
  const esri = geojsonToEsriPolygon({ type: 'MultiPolygon', coordinates: [[square], [other]] });
  assert.equal(esri.rings.length, 2);
});

test('geojsonToEsriPolygon trims coordinates to 6 decimals and rejects bad input', () => {
  const esri = geojsonToEsriPolygon({ type: 'Polygon', coordinates: [square.map(([x, y]) => [x + 0.0000004, y])] });
  assert.equal(esri.rings[0][0][0], -111.7);
  assert.throws(() => geojsonToEsriPolygon({ type: 'Point', coordinates: [0, 0] }), /Unsupported geometry/);
  assert.throws(() => geojsonToEsriPolygon({ type: 'Polygon', coordinates: [[]] }), /no usable ring/);
});

test('extractZctas dedupes, zero-pads, validates, sorts', () => {
  const zips = extractZctas([
    { attributes: { ZCTA5: '85298' } },
    { attributes: { ZCTA5: 85140 } },
    { attributes: { ZCTA5: '85298' } },
    { attributes: { ZCTA5: '1234' } },      // 4 digits -> padded to 01234 (valid NJ-style zip)
    { attributes: { ZCTA5: 'ABCDE' } },     // invalid
    { attributes: { ZCTA5: null } },
    { attributes: {} },
  ]);
  assert.deepEqual(zips, ['01234', '85140', '85298']);
});

test('formatZipList: txt is one per line, csv has header, json carries meta + count', () => {
  const zips = ['85140', '85298'];
  assert.equal(formatZipList(zips, 'txt'), '85140\n85298\n');
  assert.equal(formatZipList([], 'txt'), '');
  assert.equal(formatZipList(zips, 'csv'), 'zip\n85140\n85298\n');
  const j = JSON.parse(formatZipList(zips, 'json', { clinic_id: '48063' }));
  assert.equal(j.clinic_id, '48063');
  assert.equal(j.count, 2);
  assert.deepEqual(j.zips, zips);
});

test('exportFilename is filesystem-safe and encodes the buffer', () => {
  assert.equal(exportFilename('Hunt Highway', '48063', 5, 'txt'), 'Hunt_Highway_tiktok_zips_5mi.txt');
  assert.equal(exportFilename("O'Fallon / West", '1', 2.5, 'csv'), 'O_Fallon_West_tiktok_zips_2p5mi.csv');
  assert.equal(exportFilename(null, '48063', 5, 'json'), '48063_tiktok_zips_5mi.json');
});

test('parseBufferMiles defaults to 5, clamps to 25, rejects garbage', () => {
  assert.equal(parseBufferMiles(null), 5);
  assert.equal(parseBufferMiles(''), 5);
  assert.equal(parseBufferMiles('3'), 3);
  assert.equal(parseBufferMiles('0'), 0);
  assert.equal(parseBufferMiles('999'), 25);
  assert.equal(parseBufferMiles('-4'), 5);
  assert.equal(parseBufferMiles('abc'), 5);
});

test('parseFormat whitelists formats', () => {
  assert.equal(parseFormat(null), 'txt');
  assert.equal(parseFormat('CSV'), 'csv');
  assert.equal(parseFormat('json'), 'json');
  assert.equal(parseFormat('exe'), 'txt');
});
