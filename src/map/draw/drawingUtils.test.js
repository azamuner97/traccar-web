import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arrowBearing,
  canEditDrawings,
  createArrowheadSdfImage,
  DEFAULT_DRAWING_TEXT_SIZE,
  drawingToolbarExpandedKey,
  drawingVisibilityKey,
  drawingToEditableFeature,
  drawingsToFeatureCollection,
  editableFeatureToDrawing,
  loadDrawingVisibility,
  loadDrawingToolbarExpanded,
  normalizeDrawingColor,
  normalizeDrawingText,
  normalizeDrawingTextSize,
  staticDrawingFilter,
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
  ownerId: 7,
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
  assert.equal(payload.textSize, DEFAULT_DRAWING_TEXT_SIZE);
  assert.equal(payload.textBold, false);
  assert.equal(payload.textItalic, false);
});

test('text formatting round trips with safe defaults', () => {
  const textDrawing = {
    ...drawing,
    type: 'text',
    geometry: { type: 'Point', coordinates: [7, 46] },
    text: 'Line one\r\nLine two',
    textSize: 24,
    textBold: true,
    textItalic: true,
  };
  const feature = drawingToEditableFeature(textDrawing);
  const payload = editableFeatureToDrawing(feature);
  assert.equal(payload.text, 'Line one\nLine two');
  assert.equal(payload.textSize, 24);
  assert.equal(payload.textBold, true);
  assert.equal(payload.textItalic, true);
  assert.equal(normalizeDrawingTextSize(32), 32);
  assert.equal(normalizeDrawingTextSize(14), DEFAULT_DRAWING_TEXT_SIZE);
});

test('arrow feature collection includes a rotated endpoint', () => {
  const collection = drawingsToFeatureCollection([drawing]);
  assert.equal(collection.features.length, 2);
  assert.equal(collection.features[1].properties.drawingType, 'arrowhead');
  assert.equal(collection.features[1].properties.ownerId, drawing.ownerId);
  assert.equal(collection.features[1].properties.rotation, arrowBearing([7, 46], [8, 47]));
  assert.equal(arrowBearing([0, 0], [0, 1]), 0);
  assert.equal(arrowBearing([0, 0], [1, 0]), 90);
  assert.equal(arrowBearing([0, 0], [0, -1]), 180);
  assert.equal(arrowBearing([0, 0], [-1, 0]), -90);
});

test('arrowhead decoration is generated as a triangle SDF', () => {
  const image = createArrowheadSdfImage(32);
  assert.equal(image.width, 32);
  assert.equal(image.height, 32);
  assert.equal(image.data.length, 32 * 32 * 4);
  const alpha = (x, y) => image.data[(y * image.width + x) * 4 + 3];
  assert.ok(alpha(16, 16) > alpha(0, 0));
  assert.ok(alpha(16, 16) > 128);
});

test('static geometry is filtered only for the owner being edited', () => {
  const types = ['line', 'arrow'];
  assert.deepEqual(staticDrawingFilter(types, null), [
    'in',
    ['get', 'drawingType'],
    ['literal', types],
  ]);
  assert.deepEqual(staticDrawingFilter(types, 7), [
    'all',
    ['in', ['get', 'drawingType'], ['literal', types]],
    ['!=', ['get', 'ownerId'], 7],
  ]);
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

test('toolbar expansion is isolated by user and safely defaults to collapsed', () => {
  const values = new Map([
    [drawingToolbarExpandedKey(1), 'true'],
    [drawingToolbarExpandedKey(2), 'false'],
    [drawingToolbarExpandedKey(3), 'invalid'],
  ]);
  const storage = { getItem: (key) => values.get(key) ?? null };
  assert.notEqual(drawingToolbarExpandedKey(1), drawingToolbarExpandedKey(2));
  assert.equal(loadDrawingToolbarExpanded(storage, 1), true);
  assert.equal(loadDrawingToolbarExpanded(storage, 2), false);
  assert.equal(loadDrawingToolbarExpanded(storage, 3), false);
  assert.equal(loadDrawingToolbarExpanded(storage, 4), false);
});
