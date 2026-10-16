import { useEffect, useReducer, useState } from 'react';
import { useSelector } from 'react-redux';
import { useMediaQuery, useTheme } from '@mui/material';
import { map } from '../core/MapView';
import useMapLayer from '../core/useMapLayer';
import { findFonts, toMapCoordinates } from '../core/mapUtil';
import { useAttributePreference } from '../../common/util/preferences';
import { createProximityCircle, proximityMinimumDiameter } from './proximityCircleGeometry';
import {
  proximityCircleLabel,
  proximityCircleSessionId,
  validProximityCircle,
} from '../../main/gameProximity';

const MapParticipantProximity = () => {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const iconScale = useAttributePreference('iconScale', desktop ? 0.75 : 1);
  const user = useSelector((state) => state.session.user);
  const proximity = useSelector((state) => state.gameProximity);
  const [viewportRevision, refreshViewport] = useReducer((value) => value + 1, 0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    let frame;
    const update = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        refreshViewport();
      });
    };
    map.on('move', update);
    map.on('resize', update);
    return () => {
      map.off('move', update);
      map.off('resize', update);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
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
        layout: {
          'text-field': ['get', 'label'],
          'text-font': findFonts(map),
          'text-size': 12,
          'text-anchor': 'center',
          'text-allow-overlap': true,
          'text-ignore-placement': false,
        },
        paint: { 'text-color': '#2e7d32', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      },
    ],
    data: {
      type: 'FeatureCollection',
      features: circles.flatMap((circle) => {
        const center = toMapCoordinates(circle.longitude, circle.latitude);
        return [
          createProximityCircle(
            center,
            circle.diameterMeters,
            proximityMinimumDiameter(iconScale),
            map,
          ),
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: center },
            properties: { label: proximityCircleLabel(circle) },
          },
        ];
      }),
    },
    dataDeps: [proximity, user, now, iconScale, viewportRevision],
  });
  return null;
};
export default MapParticipantProximity;
