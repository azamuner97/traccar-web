// Local mocked API audit; never imported into the shipped application.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, useSelector } from 'react-redux';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import store, { sessionActions } from '../src/store';
import SocketController from '../src/SocketController';
import NativeInterface from '../src/common/components/NativeInterface';
import { LocalizationProvider } from '../src/common/components/LocalizationProvider';
import dimensions from '../src/common/theme/dimensions';
import EventsDrawer from '../src/main/EventsDrawer';
import MapNotification from '../src/map/control/MapNotification';
import { canReceiveGameAlert, gameAlertSessionDeviceId } from '../src/main/gameAlerts';
import { gameNotificationCache } from '../src/main/gameNotificationCache';

const sockets = [];
class AuditSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  constructor() {
    this.readyState = 0;
    sockets.push(this);
    queueMicrotask(() => {
      if (this.readyState === 0) {
        this.readyState = 1;
        this.onopen?.();
      }
    });
  }
  send() {}
  close(code) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}
window.WebSocket = AuditSocket;

let serverUser = {
  id: 5,
  attributes: {
    traccarToolUserRole: 'player',
    traccarToolSessionDeviceId: 900,
    traccarToolAssignedDeviceId: 100,
    notificationTokens: 'one,two,three',
    language: 'en',
  },
};
const userKey = 'notificationAuditUser';
serverUser = JSON.parse(window.sessionStorage.getItem(userKey) || 'null') || serverUser;
const tokenWrites = [];
const serverKey = 'notificationAuditServer';
let sessions = JSON.parse(window.sessionStorage.getItem(serverKey) || '{}');
let failing = false;
const getSession = (id) => {
  sessions[id] ||= { generation: window.crypto.randomUUID(), records: [] };
  return sessions[id];
};
const saveServer = () => window.sessionStorage.setItem(serverKey, JSON.stringify(sessions));
getSession(900);
saveServer();
const invalidate = () =>
  sockets.at(-1)?.onmessage?.({
    data: JSON.stringify({ invalidate: ['game-notifications'] }),
  });
window.fetch = async (url, options = {}) => {
  const parsed = new URL(url, window.location.origin);
  let value = [];
  if (parsed.pathname === '/api/game-notifications') {
    if (failing) return new Response('{}', { status: typeof failing === 'number' ? failing : 503 });
    const deviceId = Number(parsed.searchParams.get('sessionDeviceId'));
    const session = getSession(deviceId);
    const generation = parsed.searchParams.get('generation');
    if (generation && generation !== session.generation) return new Response('{}', { status: 409 });
    const offset = Number(parsed.searchParams.get('after') || 0);
    const limit = Number(parsed.searchParams.get('limit') || 100);
    const eligible = session.records.filter((item) => canReceiveGameAlert(item, serverUser));
    const items = eligible.slice(offset, offset + limit);
    value = {
      version: 2,
      sessionDeviceId: deviceId,
      generation: session.generation,
      items,
      nextCursor: String(offset + items.length),
      hasMore: offset + items.length < eligible.length,
    };
  }
  if (parsed.pathname === '/api/session') value = serverUser;
  if (parsed.pathname === '/api/users/5' && options.method === 'PUT') {
    serverUser = JSON.parse(options.body);
    window.sessionStorage.setItem(userKey, JSON.stringify(serverUser));
    tokenWrites.push(serverUser.attributes.notificationTokens);
    value = serverUser;
  }
  return new Response(JSON.stringify(value), { status: 200 });
};

let visible = true;
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => (visible ? 'visible' : 'hidden'),
});
Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
let sounds = 0;
window.Audio = class {
  play() {
    sounds += 1;
    return Promise.resolve();
  }
};
store.dispatch(sessionActions.updateServer({ attributes: {} }));
store.dispatch(sessionActions.updateUser(serverUser));
const Fixture = () => {
  const user = useSelector((state) => state.session.user);
  const eventsAvailable = useSelector((state) => state.events.items.length > 0);
  const unreadCount = useSelector(
    (state) => state.gameNotifications.items.filter((item) => !item.read).length,
  );
  const [open, setOpen] = useState(false);
  const location = useLocation();
  return (
    <>
      <NativeInterface />
      <div id="audit-map" />
      <div data-testid="audit-route">{location.pathname}</div>
      {user && (
        <>
          <SocketController />
          {(!user.attributes['ui.disableEvents'] || gameAlertSessionDeviceId(user)) && (
            <MapNotification
              enabled={(!user.attributes['ui.disableEvents'] && eventsAvailable) || unreadCount > 0}
              unreadCount={unreadCount}
              onClick={() => setOpen(true)}
            />
          )}
          <EventsDrawer open={open} onClose={() => setOpen(false)} />
        </>
      )}
    </>
  );
};
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <MemoryRouter>
        <ThemeProvider theme={createTheme({ dimensions })}>
          <LocalizationProvider>
            <Fixture />
          </LocalizationProvider>
        </ThemeProvider>
      </MemoryRouter>
    </Provider>
  </StrictMode>,
);

const updateUser = (changes) => {
  serverUser = { ...serverUser, attributes: { ...serverUser.attributes, ...changes } };
  window.sessionStorage.setItem(userKey, JSON.stringify(serverUser));
  store.dispatch(sessionActions.updateUser(serverUser));
};
window.notificationAudit = {
  flushHistory: () => gameNotificationCache.flush(),
  get sockets() {
    return sockets.length;
  },
  get sounds() {
    return sounds;
  },
  get errors() {
    return store.getState().errors;
  },
  get tokens() {
    return serverUser.attributes.notificationTokens;
  },
  get tokenWrites() {
    return tokenWrites;
  },
  get history() {
    return store.getState().gameNotifications;
  },
  login() {
    store.dispatch(sessionActions.updateUser(serverUser));
  },
  logout() {
    store.dispatch(sessionActions.updateUser(null));
  },
  setSession(id) {
    updateUser({ traccarToolSessionDeviceId: id });
  },
  setRole(role) {
    updateUser({ traccarToolUserRole: role });
  },
  setAssignedDevice(id) {
    updateUser({ traccarToolAssignedDeviceId: id });
  },
  disableEvents(value) {
    updateUser({ 'ui.disableEvents': value });
  },
  setLanguage(language) {
    updateUser({ language });
  },
  refreshUser() {
    updateUser({});
  },
  setVisible(value) {
    visible = value;
    document.dispatchEvent(new Event('visibilitychange'));
  },
  fail(value) {
    failing = value;
    invalidate();
  },
  reconnect() {
    invalidate();
  },
  nativeEvent(event) {
    sockets.at(-1)?.onmessage?.({ data: JSON.stringify({ events: [event] }) });
  },
  emit(alerts, deviceId = 900) {
    const session = getSession(deviceId);
    for (const alert of alerts)
      if (!session.records.some((entry) => entry.id === alert.id))
        session.records.push({
          ...alert,
          gameStateDeviceId: deviceId,
          generation: session.generation,
        });
    saveServer();
    invalidate();
  },
  reset(deviceId = 900, alerts = []) {
    const generation = window.crypto.randomUUID();
    sessions[deviceId] = {
      generation,
      records: alerts.map((alert) => ({ ...alert, generation, gameStateDeviceId: deviceId })),
    };
    saveServer();
    invalidate();
  },
  spoof(alert) {
    sockets.at(-1)?.onmessage?.({
      data: JSON.stringify({
        positions: [
          {
            deviceId: 900,
            attributes: {
              traccarToolGameState: true,
              traccarToolAlertsVersion: 1,
              traccarToolAlerts: JSON.stringify([alert]),
            },
          },
        ],
      }),
    });
  },
  malformed() {
    sockets.at(-1)?.onmessage?.({ data: '{bad' });
  },
};
