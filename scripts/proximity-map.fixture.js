// Browser-audit map projection and optional real WebGL rendering. Never shipped.
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

const createMockMap = () => {
  let zoom = 5;
  const sources = new Map();
  const layers = new Map();
  const listeners = new Map();
  const map = {
    getStyle: () => ({ glyphs: '' }),
    addSource: (id, source) => sources.set(id, { setData() {}, ...source }),
    getSource: (id) => sources.get(id),
    removeSource: (id) => sources.delete(id),
    addLayer: (layer) => layers.set(layer.id, layer),
    getLayer: (id) => layers.get(id),
    removeLayer: (id) => layers.delete(id),
    getZoom: () => zoom,
    jumpTo(options) {
      zoom = options.zoom ?? zoom;
      map.fire('move');
    },
    resize: () => map.fire('resize'),
    project(coordinates) {
      const point = maplibregl.MercatorCoordinate.fromLngLat(coordinates);
      const worldSize = 512 * 2 ** zoom;
      return { x: point.x * worldSize, y: point.y * worldSize };
    },
    unproject([x, y]) {
      const worldSize = 512 * 2 ** zoom;
      return new maplibregl.MercatorCoordinate(x / worldSize, y / worldSize).toLngLat();
    },
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    off: (type, listener) => listeners.get(type)?.delete(listener),
    fire: (type) => listeners.get(type)?.forEach((listener) => listener()),
    listenerCount: (type) => listeners.get(type)?.size || 0,
  };
  return map;
};

export const createProximityAuditMap = () => {
  const render = new URLSearchParams(window.location.search).has('render');
  let map;
  if (render) {
    maplibregl.setWorkerUrl(workerUrl);
    map = new maplibregl.Map({
      container: 'audit-map',
      center: [8, 47],
      zoom: 5,
      attributionControl: false,
      style: {
        version: 8,
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#eef1f4' } },
        ],
      },
    });
    // Omit remote glyphs so MapLibre renders audit labels using local system fonts.
    const getStyle = map.getStyle.bind(map);
    map.getStyle = () => ({ ...getStyle(), glyphs: '' });
    window.proximityMapReady = new Promise((resolve) => map.once('load', resolve));
  } else {
    map = createMockMap();
    window.proximityMapReady = Promise.resolve();
  }
  const layers = new Map();
  const addLayer = map.addLayer.bind(map);
  map.addLayer = (layer) => {
    layers.set(layer.id, layer);
    window.proximityMapLayers = [...layers.values()];
    return addLayer(layer);
  };
  const addSource = map.addSource.bind(map);
  map.addSource = (id, source) => {
    const result = addSource(id, source);
    const tracked = map.getSource(id);
    const setData = tracked.setData.bind(tracked);
    const show = (data) => {
      if (!Array.isArray(data.features)) return;
      if (data.features?.some((feature) => feature.properties?.image)) return;
      window.proximityMapData = data;
      const label = document.getElementById('circle-label');
      if (label)
        label.textContent = data.features
          .filter((feature) => feature.geometry.type === 'Point')
          .map((feature) => feature.properties.label)
          .join('; ');
    };
    tracked.setData = (data) => {
      show(data);
      return setData(data);
    };
    show(source.data);
    return result;
  };
  window.proximityMap = map;
  window.proximityDiameter = () => {
    const ring = window.proximityMapData.features.find(
      (feature) => feature.geometry.type === 'Polygon',
    )?.geometry.coordinates[0];
    if (!ring) return 0;
    const points = ring.map((coordinate) => map.project(coordinate));
    return Math.min(
      Math.max(...points.map(({ x }) => x)) - Math.min(...points.map(({ x }) => x)),
      Math.max(...points.map(({ y }) => y)) - Math.min(...points.map(({ y }) => y)),
    );
  };
  return map;
};
