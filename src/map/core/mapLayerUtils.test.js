import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapSource } from './mapLayerUtils.js';

test('recreated drawing sources retain their current data across editor collapse and expansion', () => {
  const drawings = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [7, 46],
            [8, 47],
          ],
        },
        properties: { drawingId: 1 },
      },
    ],
  };

  const collapsedSource = createMapSource(undefined, drawings);
  const expandedSource = createMapSource(undefined, drawings);
  assert.strictEqual(collapsedSource.data, drawings);
  assert.strictEqual(expandedSource.data, drawings);
  assert.equal(expandedSource.data.features.length, 1);
});

test('map sources preserve explicit GeoJSON and non-GeoJSON configuration', () => {
  const explicit = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  assert.strictEqual(createMapSource(explicit).data, explicit.data);
  const vector = { type: 'vector', url: 'mapbox://example' };
  assert.strictEqual(createMapSource(vector), vector);
});
