import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, useSelector } from 'react-redux';
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

const Fixture = () => {
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
      <MapParticipantProximity />
    </>
  );
};
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <Fixture />
    </Provider>
  </StrictMode>,
);
window.proximityAudit = {
  setRole,
  calls,
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
