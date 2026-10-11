// Local, mocked browser audit only. This is not imported into the shipped app.
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
import { gameAlertSessionDeviceId } from '../src/main/gameAlerts';

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
    notificationTokens: 'one,two,three',
    language: 'en',
  },
};
const tokenWrites = [];
window.fetch = async (url, options = {}) => {
  let value = [];
  if (url === '/api/session') value = serverUser;
  if (url === '/api/users/5' && options.method === 'PUT') {
    serverUser = JSON.parse(options.body);
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

window.notificationAudit = {
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
  setSession(deviceId) {
    serverUser = {
      ...serverUser,
      attributes: { ...serverUser.attributes, traccarToolSessionDeviceId: deviceId },
    };
    store.dispatch(sessionActions.updateUser(serverUser));
  },
  disableEvents(value) {
    serverUser = {
      ...serverUser,
      attributes: { ...serverUser.attributes, 'ui.disableEvents': value },
    };
    store.dispatch(sessionActions.updateUser(serverUser));
  },
  setLanguage(value) {
    serverUser = { ...serverUser, attributes: { ...serverUser.attributes, language: value } };
    store.dispatch(sessionActions.updateUser(serverUser));
  },
  nativeEvent(event) {
    sockets.at(-1).onmessage?.({ data: JSON.stringify({ events: [event] }) });
  },
  refreshUser() {
    store.dispatch(
      sessionActions.updateUser({ ...serverUser, attributes: { ...serverUser.attributes } }),
    );
  },
  logout() {
    store.dispatch(sessionActions.updateUser(null));
  },
  setRole(role) {
    serverUser = {
      ...serverUser,
      attributes: { ...serverUser.attributes, traccarToolUserRole: role },
    };
    store.dispatch(sessionActions.updateUser(serverUser));
  },
  setVisible(value) {
    visible = value;
    document.dispatchEvent(new Event('visibilitychange'));
  },
  emit(alerts, deviceId = 900) {
    sockets.at(-1).onmessage?.({
      data: JSON.stringify({
        positions: [
          {
            deviceId,
            attributes: {
              traccarToolGameState: true,
              traccarToolAlertsVersion: 1,
              traccarToolAlerts: JSON.stringify(alerts),
            },
          },
        ],
      }),
    });
  },
  malformed() {
    sockets.at(-1).onmessage?.({ data: '{bad' });
  },
};
