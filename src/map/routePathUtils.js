import { interpolateTurbo } from '../common/util/colors.js';

export const MAX_ROUTE_GRADIENT_STOPS = 256;

const MAX_MERCATOR_LATITUDE = 85.05112878;

const finiteCoordinate = (value) =>
  value !== null && value !== '' && Number.isFinite(Number(value));

const validRoutePositions = (positions) =>
  positions.filter(
    (position) => finiteCoordinate(position?.longitude) && finiteCoordinate(position?.latitude),
  );

const positionSpeed = (position, fallback) => {
  const speed = Number(position?.speed);
  return Number.isFinite(speed) ? speed : fallback;
};

const speedColor = (speed, minSpeed, maxSpeed) => {
  const normalizedSpeed = maxSpeed > minSpeed ? (speed - minSpeed) / (maxSpeed - minSpeed) : 0;
  const [r, g, b] = interpolateTurbo(Math.min(1, Math.max(0, normalizedSpeed)));
  return `rgb(${r}, ${g}, ${b})`;
};

const projectPosition = (position) => {
  const longitude = Number(position.longitude);
  const latitude = Math.max(
    -MAX_MERCATOR_LATITUDE,
    Math.min(MAX_MERCATOR_LATITUDE, Number(position.latitude)),
  );
  const sin = Math.sin((latitude * Math.PI) / 180);
  return [longitude / 360 + 0.5, 0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI];
};

const resolveSpeedRange = (positions, minSpeedOverride, maxSpeedOverride) => {
  let fallbackMin = Infinity;
  let fallbackMax = -Infinity;
  positions.forEach((position) => {
    const speed = Number(position.speed);
    if (Number.isFinite(speed)) {
      fallbackMin = Math.min(fallbackMin, speed);
      fallbackMax = Math.max(fallbackMax, speed);
    }
  });
  if (!Number.isFinite(fallbackMin)) {
    fallbackMin = 0;
    fallbackMax = 0;
  }
  const minSpeed = Number.isFinite(minSpeedOverride) ? minSpeedOverride : fallbackMin;
  const maxSpeed = Number.isFinite(maxSpeedOverride) ? maxSpeedOverride : fallbackMax;
  return minSpeed <= maxSpeed ? [minSpeed, maxSpeed] : [maxSpeed, minSpeed];
};

const routeMetrics = (positions) => {
  const projected = positions.map(projectPosition);
  const distances = [0];
  for (let index = 1; index < projected.length; index += 1) {
    distances.push(
      distances[index - 1] +
        Math.hypot(
          projected[index][0] - projected[index - 1][0],
          projected[index][1] - projected[index - 1][1],
        ),
    );
  }
  return { distances, totalDistance: distances.at(-1) || 0 };
};

export const buildContinuousRouteData = (positions, properties = {}) => {
  const coordinates = validRoutePositions(positions).map((position) => [
    Number(position.longitude),
    Number(position.latitude),
  ]);

  return {
    type: 'FeatureCollection',
    features:
      coordinates.length >= 2
        ? [
            {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates },
              properties,
            },
          ]
        : [],
  };
};

export const buildRouteGradient = (positions, minSpeedOverride, maxSpeedOverride) => {
  positions = validRoutePositions(positions);
  const [minSpeed, maxSpeed] = resolveSpeedRange(positions, minSpeedOverride, maxSpeedOverride);
  const fallbackColor = speedColor(minSpeed, minSpeed, maxSpeed);
  if (positions.length < 2) {
    return ['interpolate', ['linear'], ['line-progress'], 0, fallbackColor, 1, fallbackColor];
  }

  const { distances, totalDistance } = routeMetrics(positions);
  if (!totalDistance) {
    const color = speedColor(positionSpeed(positions.at(-1), minSpeed), minSpeed, maxSpeed);
    return ['interpolate', ['linear'], ['line-progress'], 0, color, 1, color];
  }

  let stops;
  if (positions.length <= MAX_ROUTE_GRADIENT_STOPS) {
    stops = [];
    positions.forEach((position, index) => {
      const progress = distances[index] / totalDistance;
      const color = speedColor(positionSpeed(position, minSpeed), minSpeed, maxSpeed);
      if (stops.length && progress === stops.at(-1)[0]) {
        stops[stops.length - 1] = [progress, color];
      } else {
        stops.push([progress, color]);
      }
    });
  } else {
    let upperIndex = 1;
    stops = Array.from({ length: MAX_ROUTE_GRADIENT_STOPS }, (_, index) => {
      const progress = index / (MAX_ROUTE_GRADIENT_STOPS - 1);
      const targetDistance = progress * totalDistance;
      while (upperIndex < distances.length - 1 && distances[upperIndex] < targetDistance) {
        upperIndex += 1;
      }
      const lowerIndex = upperIndex - 1;
      const segmentDistance = distances[upperIndex] - distances[lowerIndex];
      const segmentProgress = segmentDistance
        ? (targetDistance - distances[lowerIndex]) / segmentDistance
        : 1;
      const lowerSpeed = positionSpeed(positions[lowerIndex], minSpeed);
      const upperSpeed = positionSpeed(positions[upperIndex], lowerSpeed);
      const speed = lowerSpeed + (upperSpeed - lowerSpeed) * segmentProgress;
      return [progress, speedColor(speed, minSpeed, maxSpeed)];
    });
  }

  if (stops[0][0] !== 0) {
    stops.unshift([0, stops[0][1]]);
  }
  if (stops.at(-1)[0] !== 1) {
    stops.push([1, stops.at(-1)[1]]);
  }

  return ['interpolate', ['linear'], ['line-progress'], ...stops.flat()];
};
