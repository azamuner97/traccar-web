import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
} from 'terra-draw';
import {
  createDrawingEditorSync,
  DRAWING_SELECT_FLAGS,
  finishDrawingInteraction,
} from './drawingEditor.js';
import { drawingFeatureId } from './drawingUtils.js';

const user = { id: 2, disableDrawings: false, attributes: { traccarToolUserRole: 'hunter' } };
const arrow = {
  id: 42,
  ownerId: 1,
  canEdit: true,
  canDelete: true,
  type: 'arrow',
  color: '#FF0000',
  geometry: {
    type: 'LineString',
    coordinates: [
      [7, 46],
      [8, 47],
    ],
  },
};
const polygon = {
  ...arrow,
  id: 43,
  type: 'polygon',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [7, 46],
        [8, 46],
        [8, 47],
        [7, 46],
      ],
    ],
  },
};

const editor = () => {
  const adapter = {
    register(callbacks) {
      this.callbacks = callbacks;
    },
    unregister() {},
    render() {},
    clear() {},
    project(lng, lat) {
      return { x: lng * 100, y: lat * 100 };
    },
    unproject(x, y) {
      return { lng: x / 100, lat: y / 100 };
    },
    setCursor() {},
    setDraggability() {},
    setDoubleClickToZoom() {},
    getCoordinatePrecision() {
      return 9;
    },
  };
  const draw = new TerraDraw({
    adapter,
    modes: [
      new TerraDrawSelectMode({
        flags: DRAWING_SELECT_FLAGS,
      }),
      new TerraDrawLineStringMode(),
      new TerraDrawPolygonMode(),
    ],
  });
  draw.start();
  draw.setMode('select');
  return { draw, adapter, sync: createDrawingEditorSync(draw) };
};

test('teammate arrow and polygon selections survive websocket snapshots and additions', () => {
  for (const drawing of [arrow, polygon]) {
    const { draw, sync } = editor();
    sync([drawing], user);
    const id = drawingFeatureId(drawing.id);
    draw.selectFeature(id);
    const handles = draw.getSnapshot().filter((feature) => !feature.properties.drawingId);
    let deselections = 0;
    draw.on('deselect', () => deselections++);
    sync([structuredClone(drawing), { ...arrow, id: 44 }], { ...user });
    assert.equal(draw.getSnapshotFeature(id).properties.selected, true);
    assert.deepEqual(
      draw.getSnapshot().filter((feature) => !feature.properties.drawingId),
      handles,
    );
    assert.equal(deselections, 0);
    assert.equal(draw.hasFeature(drawingFeatureId(44)), true);
    draw.stop();
  }
});

test('a refresh cannot overwrite an unfinished teammate vertex edit', () => {
  const { draw, sync } = editor();
  sync([arrow], user);
  const id = drawingFeatureId(arrow.id);
  draw.selectFeature(id);
  const moved = {
    type: 'LineString',
    coordinates: [
      [7.1, 46.1],
      [8, 47],
    ],
  };
  draw.updateFeatureGeometry(id, moved);
  sync([structuredClone(arrow)], user);
  assert.deepEqual(draw.getSnapshotFeature(id).geometry, moved);
  assert.equal(draw.getSnapshotFeature(id).properties.selected, true);
  draw.stop();
});

test('real server geometry and property changes update a selected feature in place', () => {
  const { draw, sync } = editor();
  sync([polygon], user);
  const id = drawingFeatureId(polygon.id);
  draw.selectFeature(id);
  const changed = {
    ...polygon,
    color: '#00FF00',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [7.1, 46],
          [8, 46],
          [8, 47],
          [7.1, 46],
        ],
      ],
    },
  };
  sync([changed], user);
  const feature = draw.getSnapshotFeature(id);
  assert.equal(feature.properties.selected, true);
  assert.equal(feature.properties.color, '#00FF00');
  assert.deepEqual(feature.geometry, changed.geometry);
  draw.stop();
});

test('revocation and deletion immediately remove selected teammate features', () => {
  for (const remaining of [[], [{ ...arrow, canEdit: false }]]) {
    const { draw, sync } = editor();
    sync([arrow], user);
    const id = drawingFeatureId(arrow.id);
    draw.selectFeature(id);
    let deselections = 0;
    draw.on('deselect', () => deselections++);
    sync(remaining, user);
    assert.equal(draw.hasFeature(id), false);
    assert.equal(deselections, 1);
    draw.stop();
  }
});

test('tools-disabled and other-user snapshots fail closed', () => {
  const { draw, sync } = editor();
  sync([arrow], user);
  sync([arrow], { ...user, disableDrawings: true });
  assert.equal(draw.hasFeature(drawingFeatureId(42)), false);
  sync([{ ...arrow, canEdit: false }], user);
  assert.equal(draw.hasFeature(drawingFeatureId(42)), false);
  draw.stop();
});

test('revocation still removes loaded features while another shape is being drawn', () => {
  const { draw, adapter, sync } = editor();
  sync([arrow], user);
  draw.setMode('linestring');
  adapter.callbacks.onClick({
    lng: 7,
    lat: 46,
    containerX: 700,
    containerY: 4600,
    button: 'left',
    heldKeys: [],
  });
  assert.equal(draw.getModeState(), 'drawing');
  sync([{ ...arrow, canEdit: false }, polygon], user);
  assert.equal(draw.hasFeature(drawingFeatureId(42)), false);
  assert.equal(draw.hasFeature(drawingFeatureId(43)), false);
  assert.equal(draw.getModeState(), 'drawing');
  draw.stop();
});

test('teammate arrow and polygon midpoint drags insert, move, and finish without cancelling selection', () => {
  for (const drawing of [arrow, polygon]) {
    const { draw, adapter, sync } = editor();
    sync([drawing], user);
    const id = drawingFeatureId(drawing.id);
    draw.selectFeature(id);
    const midpoint = draw.getSnapshot().find((feature) => feature.properties.midPoint);
    const [lng, lat] = midpoint.geometry.coordinates;
    const event = {
      lng,
      lat,
      containerX: lng * 100,
      containerY: lat * 100,
      button: 'left',
      heldKeys: [],
    };
    const finishes = [];
    draw.on('finish', (featureId, context) => {
      finishes.push(context.action);
      assert.equal(finishDrawingInteraction(draw, draw.getSnapshotFeature(featureId)), false);
    });
    adapter.callbacks.onDragStart(event, () => {});
    const moved = {
      ...event,
      lng: lng + 0.1,
      lat: lat + 0.1,
      containerX: event.containerX + 10,
      containerY: event.containerY + 10,
    };
    adapter.callbacks.onDrag(moved, () => {});
    adapter.callbacks.onDragEnd(moved, () => {});
    assert.deepEqual(finishes, ['insertMidpoint', 'dragCoordinate']);
    const feature = draw.getSnapshotFeature(id);
    assert.equal(feature.properties.selected, true);
    const coordinates =
      drawing.type === 'polygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates;
    assert.deepEqual(coordinates[1], [lng + 0.1, lat + 0.1]);
    draw.stop();
  }
});

test('finishing a new drawing still returns to select mode', () => {
  const { draw } = editor();
  draw.setMode('linestring');
  assert.equal(finishDrawingInteraction(draw, { properties: {} }), true);
  assert.equal(draw.getMode(), 'select');
  draw.stop();
});

test('existing teammate vertices move without losing selection or polygon closure', () => {
  for (const drawing of [arrow, polygon]) {
    const { draw, adapter, sync } = editor();
    sync([drawing], user);
    const id = drawingFeatureId(drawing.id);
    draw.selectFeature(id);
    const event = {
      lng: 7,
      lat: 46,
      containerX: 700,
      containerY: 4600,
      button: 'left',
      heldKeys: [],
    };
    const finishes = [];
    draw.on('finish', (featureId, context) => {
      finishes.push(context.action);
      finishDrawingInteraction(draw, draw.getSnapshotFeature(featureId));
    });
    adapter.callbacks.onDragStart(event, () => {});
    const moved = { ...event, lng: 7.1, lat: 46.1, containerX: 710, containerY: 4610 };
    adapter.callbacks.onDrag(moved, () => {});
    adapter.callbacks.onDragEnd(moved, () => {});
    assert.deepEqual(finishes, ['dragCoordinate']);
    const feature = draw.getSnapshotFeature(id);
    assert.equal(feature.properties.selected, true);
    const coordinates =
      drawing.type === 'polygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates;
    assert.deepEqual(coordinates[0], [7.1, 46.1]);
    if (drawing.type === 'polygon') assert.deepEqual(coordinates.at(-1), coordinates[0]);
    draw.stop();
  }
});
