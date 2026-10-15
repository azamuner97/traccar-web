import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import turfCircle from '@turf/circle';
import { map } from '../core/MapView';
import useMapLayer from '../core/useMapLayer';
import { findFonts, toMapCoordinates } from '../core/mapUtil';
import {
  proximityCircleLabel,
  proximityCircleSessionId,
  validProximityCircle,
} from '../../main/gameProximity';

const MapParticipantProximity = () => {
  const user = useSelector((state) => state.session.user);
  const proximity = useSelector((state) => state.gameProximity);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const circles =
    proximityCircleSessionId(user) === proximity.sessionDeviceId
      ? proximity.circles.filter((circle) => validProximityCircle(circle, now))
      : [];
  useMapLayer({
    layersDeps: [],
    layers: [
      {
        key: 'fill',
        type: 'fill',
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#2e7d32', 'fill-opacity': 0.18 },
      },
      {
        key: 'outline',
        type: 'line',
        filter: ['==', '$type', 'Polygon'],
        paint: { 'line-color': '#2e7d32', 'line-width': 2 },
      },
      {
        key: 'label',
        type: 'symbol',
        filter: ['==', '$type', 'Point'],
        layout: { 'text-field': ['get', 'label'], 'text-font': findFonts(map), 'text-size': 12 },
        paint: { 'text-color': '#2e7d32', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      },
    ],
    data: {
      type: 'FeatureCollection',
      features: circles.flatMap((circle) => {
        const center = toMapCoordinates(circle.longitude, circle.latitude);
        return [
          turfCircle(center, circle.diameterMeters / 2000),
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: center },
            properties: { label: proximityCircleLabel(circle) },
          },
        ];
      }),
    },
    dataDeps: [proximity, user, now],
  });
  return null;
};
export default MapParticipantProximity;
