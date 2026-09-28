const MODE_BY_TYPE = {
  line: 'linestring',
  arrow: 'linestring',
  polygon: 'polygon',
  rectangle: 'rectangle',
  circle: 'circle',
  text: 'point',
};

export const DEFAULT_DRAWING_TEXT_SIZE = 16;
export const DRAWING_TEXT_SIZES = [12, 16, 24, 32];

export const normalizeDrawingColor = (color, fallback = '#FF0000') =>
  /^#[0-9a-f]{6}$/i.test(color || '') ? color.toUpperCase() : fallback;

export const normalizeDrawingText = (text) =>
  String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .slice(0, 200);

export const normalizeDrawingTextSize = (textSize) =>
  DRAWING_TEXT_SIZES.includes(Number(textSize)) ? Number(textSize) : DEFAULT_DRAWING_TEXT_SIZE;

export const drawingVisibilityKey = (userId) => `mapDrawingsVisible:${userId}`;

export const drawingToolbarExpandedKey = (userId) => `mapDrawingsExpanded:${userId}`;

export const loadDrawingVisibility = (storage, userId) =>
  storage.getItem(drawingVisibilityKey(userId)) !== 'false';

export const loadDrawingToolbarExpanded = (storage, userId) =>
  storage.getItem(drawingToolbarExpandedKey(userId)) === 'true';

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
    textSize: normalizeDrawingTextSize(drawing.textSize),
    textBold: Boolean(drawing.textBold),
    textItalic: Boolean(drawing.textItalic),
  },
});

export const editableFeatureToDrawing = (
  feature,
  type,
  color,
  text,
  transform = (position) => position,
) => {
  const drawingType = type || feature.properties.drawingType;
  return {
    type: drawingType,
    geometry: transformDrawingGeometry(feature.geometry, transform),
    color: normalizeDrawingColor(color || feature.properties.color),
    text: drawingType === 'text' ? normalizeDrawingText(text ?? feature.properties.text) : null,
    textSize:
      drawingType === 'text'
        ? normalizeDrawingTextSize(feature.properties.textSize)
        : DEFAULT_DRAWING_TEXT_SIZE,
    textBold: drawingType === 'text' && Boolean(feature.properties.textBold),
    textItalic: drawingType === 'text' && Boolean(feature.properties.textItalic),
  };
};

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

const distanceToSegment = (x, y, start, end) => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const position = lengthSquared
    ? Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared))
    : 0;
  return Math.hypot(x - (start[0] + position * dx), y - (start[1] + position * dy));
};

export const createArrowheadSdfImage = (size = 32) => {
  const vertices = [
    [size / 2, 2],
    [size - 2, size - 3],
    [2, size - 3],
  ];
  const data = new Uint8Array(size * size * 4);
  const spread = Math.max(4, size / 6);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const signs = vertices.map((vertex, index) => {
        const next = vertices[(index + 1) % vertices.length];
        return (x - next[0]) * (vertex[1] - next[1]) - (vertex[0] - next[0]) * (y - next[1]);
      });
      const inside = signs.every((value) => value >= 0) || signs.every((value) => value <= 0);
      const distance = Math.min(
        ...vertices.map((vertex, index) =>
          distanceToSegment(x, y, vertex, vertices[(index + 1) % vertices.length]),
        ),
      );
      const alpha = Math.round(
        Math.max(0, Math.min(255, 128 + (inside ? distance : -distance) * (128 / spread))),
      );
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  return { width: size, height: size, data };
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
      textSize: normalizeDrawingTextSize(drawing.textSize),
      textBold: Boolean(drawing.textBold),
      textItalic: Boolean(drawing.textItalic),
      ownerId: drawing.ownerId,
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

export const staticDrawingFilter = (types, editingOwnerId) => {
  const typeFilter = ['in', ['get', 'drawingType'], ['literal', types]];
  return editingOwnerId == null
    ? typeFilter
    : ['all', typeFilter, ['!=', ['get', 'ownerId'], editingOwnerId]];
};

export const canEditDrawings = (user) =>
  Boolean(
    user?.administrator ||
    (!user?.disableDrawings && user?.attributes?.traccarToolUserRole !== 'spectator'),
  );
