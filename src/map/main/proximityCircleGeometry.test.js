import assert from 'node:assert/strict';
import test from 'node:test';
import { MercatorCoordinate } from 'maplibre-gl';
import turfCircle from '@turf/circle';
import { createProximityCircle, proximityMinimumDiameter } from './proximityCircleGeometry.js';

const projectionAt = (zoom) => {
  const worldSize = 512 * 2 ** zoom;
  return {
    project(coordinates) {
      const point = MercatorCoordinate.fromLngLat(coordinates);
      return { x: point.x * worldSize, y: point.y * worldSize };
    },
    unproject([x, y]) {
      return new MercatorCoordinate(x / worldSize, y / worldSize).toLngLat();
    },
  };
};

const displayedDiameter = (feature, projection) => {
  const points = feature.geometry.coordinates[0].map((coordinate) =>
    projection.project(coordinate),
  );
  return Math.min(
    Math.max(...points.map(({ x }) => x)) - Math.min(...points.map(({ x }) => x)),
    Math.max(...points.map(({ y }) => y)) - Math.min(...points.map(({ y }) => y)),
  );
};

test('minimum diameter matches desktop, mobile, and custom device icon scales', () => {
  for (const [scale, diameter] of [
    [0.5, 24],
    [0.75, 36],
    [1, 48],
    [1.5, 72],
  ]) {
    assert.equal(proximityMinimumDiameter(scale), diameter);
    const projection = projectionAt(5);
    const feature = createProximityCircle([8, 47], 300, diameter, projection);
    assert.ok(Math.abs(displayedDiameter(feature, projection) - diameter) < 0.001);
  }
});

test('zoomed-out circles stay visible across latitudes and fractional zooms', () => {
  for (const latitude of [-70, 0, 47, 80]) {
    for (const zoom of [2, 6.5, 10.25]) {
      const projection = projectionAt(zoom);
      const feature = createProximityCircle([8, latitude], 300, 48, projection);
      assert.ok(displayedDiameter(feature, projection) >= 48 - 0.001, `${latitude}, ${zoom}`);
      const ring = feature.geometry.coordinates[0];
      assert.deepEqual(ring[0], ring.at(-1));
      assert.ok(ring.every((point) => point.every(Number.isFinite)));
    }
  }
});

test('zooming in restores exactly the configured geographic circle', () => {
  const center = Object.freeze([8, 47]);
  const expected = turfCircle(center, 0.15);
  const near = createProximityCircle(center, 300, 48, projectionAt(17));
  assert.deepEqual(near, expected);
  const far = createProximityCircle(center, 300, 48, projectionAt(5));
  assert.notDeepEqual(far.geometry, expected.geometry);
  assert.deepEqual(createProximityCircle(center, 300, 48, projectionAt(17)), expected);
});

test('crossing the minimum size is continuous and does not shrink large circles', () => {
  for (let zoom = 10; zoom <= 16; zoom += 0.125) {
    const projection = projectionAt(zoom);
    const original = turfCircle([8, 47], 0.15);
    const expected = Math.max(36, displayedDiameter(original, projection));
    const displayed = createProximityCircle([8, 47], 300, 36, projection);
    assert.ok(Math.abs(displayedDiameter(displayed, projection) - expected) < 0.001);
  }
});

test('minimum circles near the date line use their center world copy', () => {
  const projection = projectionAt(5);
  for (const longitude of [-179.9999, 179.9999, 540]) {
    const feature = createProximityCircle([longitude, 47], 300, 48, projection);
    assert.ok(Math.abs(displayedDiameter(feature, projection) - 48) < 0.001);
    const points = feature.geometry.coordinates[0];
    assert.ok(points.every(([lng]) => Math.abs(lng - longitude) < 2));
  }
});

test('tiny geographic circles still produce a finite closed minimum-size polygon', () => {
  const projection = projectionAt(2);
  const feature = createProximityCircle([8, 47], Number.MIN_VALUE, 48, projection);
  assert.ok(Math.abs(displayedDiameter(feature, projection) - 48) < 0.001);
  const ring = feature.geometry.coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1));
});
