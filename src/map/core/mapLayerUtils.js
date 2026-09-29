const emptyFeatureCollection = { type: 'FeatureCollection', features: [] };

export const createMapSource = (source, data) => {
  const isGeoJson = !source?.type || source.type === 'geojson';
  return isGeoJson
    ? { type: 'geojson', ...source, data: data ?? source?.data ?? emptyFeatureCollection }
    : source;
};
