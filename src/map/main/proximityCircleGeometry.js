import turfCircle from '@turf/circle';

// Device marker backgrounds are 48 CSS pixels before the iconScale preference.
export const proximityMinimumDiameter = (iconScale) => 48 * iconScale;

export const createProximityCircle = (center, diameterMeters, minimumDiameter, projection) => {
  const feature = turfCircle(center, diameterMeters / 2000);
  const ring = feature.geometry.coordinates[0];
  const pixels = ring.map(([longitude, latitude]) =>
    projection.project([
      // Measure the ring in the same world copy as its center near the date line.
      longitude + 360 * Math.round((center[0] - longitude) / 360),
      latitude,
    ]),
  );
  const width =
    Math.max(...pixels.map((point) => point.x)) - Math.min(...pixels.map((point) => point.x));
  const height =
    Math.max(...pixels.map((point) => point.y)) - Math.min(...pixels.map((point) => point.y));
  const diameter = Math.min(width, height);
  if (diameter >= minimumDiameter || !Number.isFinite(diameter)) return feature;

  const origin = projection.project(center);
  const scale = minimumDiameter / diameter;
  // Expand only the displayed polygon. The configured geographic diameter is unchanged.
  feature.geometry.coordinates[0] = pixels.map((point, index) => {
    const angle = (index / (pixels.length - 1)) * 2 * Math.PI;
    const offsetX =
      diameter > 0 ? (point.x - origin.x) * scale : (Math.cos(angle) * minimumDiameter) / 2;
    const offsetY =
      diameter > 0 ? (point.y - origin.y) * scale : (Math.sin(angle) * minimumDiameter) / 2;
    const location = projection.unproject([origin.x + offsetX, origin.y + offsetY]);
    return [location.lng, location.lat];
  });
  const displayedRing = feature.geometry.coordinates[0];
  displayedRing[displayedRing.length - 1] = [...displayedRing[0]];
  return feature;
};
