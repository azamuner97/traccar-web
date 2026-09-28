import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arrowBearing,
  canEditDrawings,
  drawingVisibilityKey,
  drawingToEditableFeature,
  drawingsToFeatureCollection,
  editableFeatureToDrawing,
  loadDrawingVisibility,
  normalizeDrawingColor,
  normalizeDrawingText,
} from './drawingUtils.js';

const drawing = {
  id: 42,
  type: 'arrow',
  geometry: {
    type: 'LineString',
    coordinates: [
      [7, 46],
      [8, 47],
    ],
  },
  color: '#12abef',
  ownerName: 'Hunter',
};

test('drawing geometry round trips through a coordinate transform', () => {
  const forward = ([x, y]) => [x + 10, y - 5];
  const reverse = ([x, y]) => [x - 10, y + 5];
  const feature = drawingToEditableFeature(drawing, forward);
  const payload = editableFeatureToDrawing(feature, undefined, undefined, undefined, reverse);
  assert.deepEqual(payload.geometry, drawing.geometry);
  assert.equal(payload.type, 'arrow');
  assert.equal(payload.color, '#12ABEF');
});

test('arrow feature collection includes a rotated endpoint', () => {
  const collection = drawingsToFeatureCollection([drawing]);
  assert.equal(collection.features.length, 2);
  assert.equal(collection.features[1].properties.drawingType, 'arrowhead');
  assert.equal(collection.features[1].properties.rotation, arrowBearing([7, 46], [8, 47]));
  assert.equal(arrowBearing([0, 0], [0, 1]), 0);
  assert.equal(arrowBearing([0, 0], [1, 0]), 90);
  assert.equal(arrowBearing([0, 0], [0, -1]), 180);
  assert.equal(arrowBearing([0, 0], [-1, 0]), -90);
});

test('drawing values and permissions are normalized', () => {
  assert.equal(normalizeDrawingColor('#aabbcc'), '#AABBCC');
  assert.equal(normalizeDrawingColor('red'), '#FF0000');
  assert.equal(normalizeDrawingText(`a\r\n${'x'.repeat(250)}`).length, 200);
  assert.equal(canEditDrawings({ disableDrawings: false, attributes: {} }), true);
  assert.equal(
    canEditDrawings({ disableDrawings: false, attributes: { traccarToolUserRole: 'spectator' } }),
    false,
  );
  assert.equal(canEditDrawings({ administrator: true, disableDrawings: true }), true);
});

test('drawing visibility is isolated by user and safely defaults to visible', () => {
  const values = new Map([
    [drawingVisibilityKey(1), 'false'],
    [drawingVisibilityKey(2), 'true'],
    [drawingVisibilityKey(3), 'invalid'],
  ]);
  const storage = { getItem: (key) => values.get(key) ?? null };
  assert.notEqual(drawingVisibilityKey(1), drawingVisibilityKey(2));
  assert.equal(loadDrawingVisibility(storage, 1), false);
  assert.equal(loadDrawingVisibility(storage, 2), true);
  assert.equal(loadDrawingVisibility(storage, 3), true);
  assert.equal(loadDrawingVisibility(storage, 4), true);
});
