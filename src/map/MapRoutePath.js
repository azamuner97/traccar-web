import { useSelector } from 'react-redux';
import useMapLayer from './core/useMapLayer';
import getSpeedColor from '../common/util/colors';
import { useAttributePreference } from '../common/util/preferences';
import { toMapCoordinates } from './core/mapUtil';
import { buildContinuousRouteData, buildRouteGradient } from './routePathUtils';

const MapRoutePath = ({
  positions,
  minSpeed: minSpeedOverride,
  maxSpeed: maxSpeedOverride,
  continuousLine = false,
}) => {
  const reportColor = useSelector((state) => {
    const position = positions?.find(() => true);
    if (position) {
      const attributes = state.devices.items[position.deviceId]?.attributes;
      if (attributes) {
        const color = attributes['web.reportColor'];
        if (color) {
          return color;
        }
      }
    }
    return null;
  });

  const mapLineWidth = useAttributePreference('mapLineWidth', 2);
  const mapLineOpacity = useAttributePreference('mapLineOpacity', 1);

  const minSpeed =
    minSpeedOverride ??
    positions.reduce((result, position) => Math.min(result, position.speed), Infinity);
  const maxSpeed =
    maxSpeedOverride ??
    positions.reduce((result, position) => Math.max(result, position.speed), -Infinity);
  const routePositions = positions.map((position) => {
    const [longitude, latitude] = toMapCoordinates(position.longitude, position.latitude);
    return { longitude, latitude, speed: position.speed };
  });

  let data;
  if (continuousLine) {
    data = buildContinuousRouteData(routePositions, {
      width: mapLineWidth,
      opacity: mapLineOpacity,
    });
  } else {
    const features = [];
    for (let i = 0; i < routePositions.length - 1; i += 1) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [routePositions[i].longitude, routePositions[i].latitude],
            [routePositions[i + 1].longitude, routePositions[i + 1].latitude],
          ],
        },
        properties: {
          color: reportColor || getSpeedColor(routePositions[i + 1].speed, minSpeed, maxSpeed),
          width: mapLineWidth,
          opacity: mapLineOpacity,
        },
      });
    }
    data = { type: 'FeatureCollection', features };
  }

  useMapLayer({
    source: continuousLine ? { lineMetrics: true } : undefined,
    layers: [
      {
        type: 'line',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          ...(continuousLine
            ? {
                'line-gradient':
                  reportColor || buildRouteGradient(routePositions, minSpeed, maxSpeed),
              }
            : { 'line-color': ['get', 'color'] }),
          'line-width': ['get', 'width'],
          'line-opacity': ['get', 'opacity'],
        },
      },
    ],
    layersDeps: [continuousLine, reportColor, minSpeed, maxSpeed, positions],
    data,
    dataDeps: [
      positions,
      reportColor,
      mapLineWidth,
      mapLineOpacity,
      minSpeed,
      maxSpeed,
      continuousLine,
    ],
  });

  return null;
};

export default MapRoutePath;
