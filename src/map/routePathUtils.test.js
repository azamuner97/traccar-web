import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_ROUTE_GRADIENT_STOPS,
  buildContinuousRouteData,
  buildRouteGradient,
} from './routePathUtils.js';

const positions = [
  { longitude: 8.5, latitude: 47.3, speed: 0 },
  { longitude: 8.51, latitude: 47.31, speed: 10 },
  { longitude: 8.52, latitude: 47.32, speed: 20 },
];

const gradientStops = (gradient) => {
  const values = gradient.slice(3);
  return Array.from({ length: values.length / 2 }, (_, index) => [
    values[index * 2],
    values[index * 2 + 1],
  ]);
};

test('builds one continuous route feature in position order', () => {
  const result = buildContinuousRouteData(positions, { width: 2, opacity: 1 });

  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].geometry.type, 'LineString');
  assert.deepEqual(result.features[0].geometry.coordinates, [
    [8.5, 47.3],
    [8.51, 47.31],
    [8.52, 47.32],
  ]);
  assert.deepEqual(result.features[0].properties, { width: 2, opacity: 1 });
});

test('omits invalid coordinates and incomplete route geometry', () => {
  assert.deepEqual(buildContinuousRouteData([]).features, []);
  assert.deepEqual(buildContinuousRouteData([positions[0]]).features, []);
  assert.deepEqual(
    buildContinuousRouteData([
      positions[0],
      { longitude: Number.NaN, latitude: 47.3 },
      positions[1],
    ]).features[0].geometry.coordinates,
    [
      [8.5, 47.3],
      [8.51, 47.31],
    ],
  );
  assert.deepEqual(
    buildContinuousRouteData([positions[0], { longitude: null, latitude: 47.3 }]).features,
    [],
  );
});

test('builds strictly ordered gradient stops across a shared speed range', () => {
  const stops = gradientStops(buildRouteGradient(positions, 0, 40));
  const localRangeStops = gradientStops(buildRouteGradient(positions, 0, 20));

  assert.equal(stops[0][0], 0);
  assert.equal(stops.at(-1)[0], 1);
  assert.ok(stops.every((stop, index) => index === 0 || stop[0] > stops[index - 1][0]));
  assert.notEqual(stops[0][1], stops.at(-1)[1]);
  assert.notEqual(stops.at(-1)[1], localRangeStops.at(-1)[1]);
});

test('limits dense route gradients to MapLibre color-ramp resolution', () => {
  const densePositions = Array.from({ length: 2_000 }, (_, index) => ({
    longitude: 8.5 + index * 0.00001,
    latitude: 47.3 + index * 0.00001,
    speed: index % 70,
  }));
  const stops = gradientStops(buildRouteGradient(densePositions, 0, 69));

  assert.equal(stops.length, MAX_ROUTE_GRADIENT_STOPS);
  assert.equal(stops[0][0], 0);
  assert.equal(stops.at(-1)[0], 1);
});

test('handles duplicate coordinates and constant speed safely', () => {
  const duplicatePositions = [
    { longitude: 8.5, latitude: 47.3, speed: 5 },
    { longitude: 8.5, latitude: 47.3, speed: 5 },
    { longitude: 8.51, latitude: 47.31, speed: 5 },
  ];
  const stops = gradientStops(buildRouteGradient(duplicatePositions, 5, 5));

  assert.equal(stops[0][0], 0);
  assert.equal(stops.at(-1)[0], 1);
  assert.ok(
    stops.every(([progress, color]) => Number.isFinite(progress) && !color.includes('NaN')),
  );
});

test('returns a valid constant gradient for fewer than two valid positions', () => {
  for (const route of [
    [],
    [positions[0]],
    [positions[0], { longitude: Number.NaN, latitude: 47.3, speed: 10 }],
  ]) {
    const stops = gradientStops(buildRouteGradient(route, 0, 0));
    assert.deepEqual(
      stops.map(([progress]) => progress),
      [0, 1],
    );
    assert.equal(stops[0][1], stops[1][1]);
  }
});
