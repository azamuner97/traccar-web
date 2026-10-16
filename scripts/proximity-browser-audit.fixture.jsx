import { StrictMode, useEffect, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, useSelector } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import MapMarkers from '../src/map/MapMarkers';
import hunterBackground from '../src/resources/images/background-hunter.svg';
import { loadImage, prepareIcon } from '../src/map/core/mapUtil';
import store, { devicesActions, sessionActions } from '../src/store';
import GameProximityController from '../src/main/GameProximityController';
import MapParticipantProximity from '../src/map/main/MapParticipantProximity';
import { requestProximitySync } from '../src/main/gameProximity';

let failure = false;
let accessFailure = false;
let grants = [];
let devices = [{ id: 11, name: 'Self' }];
let circles = [];
const calls = [];
window.fetch = async (url) => {
  calls.push(url);
  if (failure) throw new Error('Offline');
  if (accessFailure && url.endsWith('/access')) return new Response('{}', { status: 500 });
  let value = [];
  if (url === '/api/devices') value = devices;
  if (url === '/api/positions')
    value = devices.map((device) => ({
      deviceId: device.id,
      latitude: 47,
      longitude: 8,
      fixTime: new Date().toISOString(),
    }));
  if (url.endsWith('/circles')) value = circles;
  if (url.endsWith('/access')) value = grants;
  return new Response(JSON.stringify(value), { status: 200 });
};
const setRole = (role) =>
  store.dispatch(
    sessionActions.updateUser({
      id: 111,
      attributes: {
        traccarToolUserRole: role,
        traccarToolSessionDeviceId: 900,
        traccarToolAssignedDeviceId: 11,
      },
    }),
  );
store.dispatch(sessionActions.updateServer({ attributes: {} }));
store.dispatch(sessionActions.updateSocket(true));
setRole('hunter');

const AuditDeviceMarker = () => {
  const [, refresh] = useReducer((value) => value + 1, 0);
  useEffect(() => {
    window.proximityMap.on('move', refresh);
    return () => window.proximityMap.off('move', refresh);
  }, []);
  const map = window.proximityMap;
  const location = map.unproject([
    map.getCanvas().clientWidth / 2 + 110,
    map.getCanvas().clientHeight / 2,
  ]);
  return (
    <MapMarkers
      markers={[
        {
          id: 1,
          longitude: location.lng,
          latitude: location.lat,
          image: 'audit-hunter',
          title: 'Hunter device',
        },
      ]}
      showTitles
    />
  );
};

const Fixture = () => {
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    window.proximityAudit.mountMap = setMounted;
    return () => {
      delete window.proximityAudit.mountMap;
    };
  }, []);
  const items = useSelector((state) => state.devices.items);
  const positions = useSelector((state) => state.session.positions);
  const selected = useSelector((state) => state.devices.selectedId);
  return (
    <>
      <div id="circle-label" />
      <div data-testid="devices">{Object.keys(items).join(',')}</div>
      <div data-testid="positions">{Object.keys(positions).join(',')}</div>
      <div data-testid="selected">{selected ?? ''}</div>
      <GameProximityController />
      {mounted && <MapParticipantProximity />}
      {new URLSearchParams(window.location.search).has('render') && <AuditDeviceMarker />}
    </>
  );
};
window.proximityMapReady.then(async () => {
  if (new URLSearchParams(window.location.search).has('render')) {
    const image = prepareIcon(await loadImage(hunterBackground));
    window.proximityMap.addImage('audit-hunter', image, { pixelRatio: window.devicePixelRatio });
    window.proximityMap.addSource('crowded-label', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [8, 47] },
        properties: {},
      },
    });
    window.proximityMap.addLayer({
      id: 'crowded-label',
      type: 'symbol',
      source: 'crowded-label',
      layout: { 'text-field': 'Other map label', 'text-font': ['Arial'], 'text-size': 14 },
    });
  }
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <Provider store={store}>
        <ThemeProvider theme={createTheme({ palette: { neutral: { main: '#888888' } } })}>
          <Fixture />
        </ThemeProvider>
      </Provider>
    </StrictMode>,
  );
  window.proximityAudit.ready = true;
});
window.proximityAudit = {
  setRole,
  calls,
  iconScale(value) {
    const user = store.getState().session.user;
    store.dispatch(
      sessionActions.updateUser({ ...user, attributes: { ...user.attributes, iconScale: value } }),
    );
  },
  circle(seconds = 60) {
    circles = [
      {
        id: 'group',
        latitude: 47,
        longitude: 8,
        diameterMeters: 500,
        playerCount: 2,
        supporterCount: 1,
        expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
      },
    ];
    requestProximitySync();
  },
  grant(seconds = 3) {
    devices = [
      { id: 11, name: 'Self' },
      { id: 12, name: 'Peer' },
    ];
    grants = [{ deviceId: 12, expiresAt: new Date(Date.now() + seconds * 1000).toISOString() }];
    requestProximitySync();
  },
  select: (deviceId) => store.dispatch(devicesActions.selectId(deviceId)),
  latePeerPacket() {
    store.dispatch(devicesActions.update([{ id: 12, name: 'Peer' }]));
    store.dispatch(sessionActions.updatePositions([{ deviceId: 12, latitude: 47, longitude: 8 }]));
    store.dispatch(devicesActions.selectId(12));
  },
  offline() {
    failure = true;
    store.dispatch(sessionActions.updateSocket(false));
  },
  restore() {
    failure = false;
    accessFailure = false;
    requestProximitySync();
  },
  rejectAccess() {
    accessFailure = true;
    requestProximitySync();
  },
  revoke() {
    devices = [{ id: 11, name: 'Self' }];
    grants = [];
    requestProximitySync();
  },
};
