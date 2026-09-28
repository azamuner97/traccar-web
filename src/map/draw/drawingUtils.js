const MODE_BY_TYPE = {
  line: 'linestring',
  arrow: 'linestring',
  polygon: 'polygon',
  rectangle: 'rectangle',
  circle: 'circle',
  text: 'point',
};

export const normalizeDrawingColor = (color, fallback = '#FF0000') =>
  /^#[0-9a-f]{6}$/i.test(color || '') ? color.toUpperCase() : fallback;

export const normalizeDrawingText = (text) =>
  String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .slice(0, 200);

export const drawingVisibilityKey = (userId) => `mapDrawingsVisible:${userId}`;

export const loadDrawingVisibility = (storage, userId) =>
  storage.getItem(drawingVisibilityKey(userId)) !== 'false';

export const transformDrawingGeometry = (geometry, transform) => {
  const transformCoordinates = (coordinates) => {
    if (
      Array.isArray(coordinates) &&
      coordinates.length === 2 &&
      coordinates.every((value) => typeof value === 'number')
    ) {
      return transform(coordinates);
    }
    return coordinates.map(transformCoordinates);
  };
  return {
    ...geometry,
    coordinates: transformCoordinates(geometry.coordinates),
  };
};

export const drawingFeatureId = (drawingId) =>
  `00000000-0000-4000-8000-${String(drawingId).padStart(12, '0')}`;

export const drawingToEditableFeature = (drawing, transform = (position) => position) => ({
  id: drawingFeatureId(drawing.id),
  type: 'Feature',
  geometry: transformDrawingGeometry(drawing.geometry, transform),
  properties: {
    mode: MODE_BY_TYPE[drawing.type],
    drawingId: drawing.id,
    drawingType: drawing.type,
    color: normalizeDrawingColor(drawing.color),
    text: drawing.text || '',
  },
});

export const editableFeatureToDrawing = (
  feature,
  type,
  color,
  text,
  transform = (position) => position,
) => ({
  type: type || feature.properties.drawingType,
  geometry: transformDrawingGeometry(feature.geometry, transform),
  color: normalizeDrawingColor(color || feature.properties.color),
  text:
    (type || feature.properties.drawingType) === 'text'
      ? normalizeDrawingText(text ?? feature.properties.text)
      : null,
});

export const arrowBearing = (start, end) => {
  const startLongitude = (start[0] * Math.PI) / 180;
  const startLatitude = (start[1] * Math.PI) / 180;
  const endLongitude = (end[0] * Math.PI) / 180;
  const endLatitude = (end[1] * Math.PI) / 180;
  const x = Math.sin(endLongitude - startLongitude) * Math.cos(endLatitude);
  const y =
    Math.cos(startLatitude) * Math.sin(endLatitude) -
    Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(endLongitude - startLongitude);
  return (Math.atan2(x, y) * 180) / Math.PI;
};

export const drawingsToFeatureCollection = (drawings, transform = (position) => position) => {
  const features = [];
  drawings.forEach((drawing) => {
    const geometry = transformDrawingGeometry(drawing.geometry, transform);
    const properties = {
      drawingId: drawing.id,
      drawingType: drawing.type,
      color: normalizeDrawingColor(drawing.color),
      text: drawing.text || '',
      ownerName: drawing.ownerName || '',
    };
    features.push({
      id: drawing.id,
      type: 'Feature',
      geometry,
      properties,
    });
    if (drawing.type === 'arrow' && geometry.coordinates.length >= 2) {
      const end = geometry.coordinates.at(-1);
      const start = geometry.coordinates.at(-2);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: end },
        properties: {
          ...properties,
          drawingType: 'arrowhead',
          rotation: arrowBearing(start, end),
        },
      });
    }
  });
  return { type: 'FeatureCollection', features };
};

export const canEditDrawings = (user) =>
  Boolean(
    user?.administrator ||
    (!user?.disableDrawings && user?.attributes?.traccarToolUserRole !== 'spectator'),
  );
