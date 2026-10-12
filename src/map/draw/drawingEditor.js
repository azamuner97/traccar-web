import { canEditDrawing, drawingToEditableFeature } from './drawingUtils.js';

export const DRAWING_SELECT_FLAGS = {
  linestring: {
    feature: {
      draggable: true,
      coordinates: { draggable: true, midpoints: { draggable: true }, deletable: true },
    },
  },
  polygon: {
    feature: {
      draggable: true,
      coordinates: { draggable: true, midpoints: { draggable: true }, deletable: true },
    },
  },
  rectangle: { feature: { draggable: true, scaleable: true } },
  circle: { feature: { draggable: true, scaleable: true } },
  point: { feature: { draggable: true } },
};

export const finishDrawingInteraction = (draw, feature) => {
  // Midpoint insertion finishes before its drag starts. Do not restart select mode.
  if (feature.properties.drawingId) return false;
  draw.setMode('select');
  return true;
};

// Keep server snapshots separate from the editor's transient selection and drag state.
export const createDrawingEditorSync = (draw, transform = (position) => position) => {
  const applied = new Map();

  return (drawings, user) => {
    if (!draw.enabled) return;
    const editable = new Map(
      drawings
        .filter((drawing) => canEditDrawing(drawing, user))
        .map((drawing) => {
          const feature = drawingToEditableFeature(drawing, transform);
          return [feature.id, feature];
        }),
    );
    const removed = draw
      .getSnapshot()
      .filter((feature) => feature.properties.drawingId && !editable.has(feature.id))
      .map((feature) => feature.id);
    if (removed.length) draw.removeFeatures(removed);
    removed.forEach((id) => applied.delete(id));
    // Revocation must still take effect while creating a new shape.
    if (draw.getModeState() === 'drawing') return;

    editable.forEach((feature, id) => {
      const signature = JSON.stringify({
        geometry: feature.geometry,
        properties: feature.properties,
      });
      if (applied.get(id) === signature && draw.hasFeature(id)) return;
      const current = draw.getSnapshotFeature(id);
      if (!current || current.properties.mode !== feature.properties.mode) {
        if (current) draw.removeFeatures([id]);
        const [result] = draw.addFeatures([feature]);
        if (result.valid) applied.set(id, signature);
        return;
      }
      if (JSON.stringify(current.geometry) !== JSON.stringify(feature.geometry)) {
        draw.updateFeatureGeometry(id, feature.geometry);
      }
      const changed = Object.fromEntries(
        Object.entries(feature.properties).filter(
          ([key, value]) => key !== 'mode' && current.properties[key] !== value,
        ),
      );
      if (Object.keys(changed).length) draw.updateFeatureProperties(id, changed);
      applied.set(id, signature);
    });
  };
};
