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
import { canReceiveGameAlert } from '../src/main/gameAlerts';
import { gameNotificationCache } from '../src/main/gameNotificationCache';
import { gameMemberKey, selectGameMembership } from '../src/game/gameView';
import useGameMembership from '../src/game/useGameMembership';

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
    notificationTokens: 'one,two,three',
    language: 'en',
  },
};
const userKey = 'notificationAuditUser';
serverUser = JSON.parse(window.sessionStorage.getItem(userKey) || 'null') || serverUser;
// The server's membership binding (data model 2): /api/game-status names it, user attributes do not. A role
// change makes a new member, so each role has its own member ID; null means no membership (403).
const memberIds = { player: 40, supporter: 41, hunter: 42, spectator: 43 };
const membershipKey = 'notificationAuditMembership';
let membership = JSON.parse(window.sessionStorage.getItem(membershipKey) || 'null') || {
  gameSessionId: 3,
  role: 'player',
};
const saveMembership = () =>
  window.sessionStorage.setItem(membershipKey, JSON.stringify(membership ?? { none: true }));
if (membership.none) membership = null;
const serverMember = () =>
  membership && {
    userId: serverUser.id,
    gameSessionId: membership.gameSessionId,
    memberId: memberIds[membership.role],
    role: membership.role,
    number: 1,
  };
const projections = {
  player: { participantOverview: [], fakes: [], plannedBreaks: [] },
  supporter: { participantOverview: [], fakes: [], plannedBreaks: [] },
  hunter: { participants: [], limits: {}, lastSpeedhuntMemberId: null, liveShares: [] },
  spectator: { participants: [], limits: {} },
};
const tokenWrites = [];
const serverKey = 'notificationAuditServer';
let sessions = JSON.parse(window.sessionStorage.getItem(serverKey) || '{}');
let failing = false;
const getSession = (id) => {
  sessions[id] ||= { generation: window.crypto.randomUUID(), records: [] };
  return sessions[id];
};
const saveServer = () => window.sessionStorage.setItem(serverKey, JSON.stringify(sessions));
getSession(3);
saveServer();
const invalidate = (resources = ['game-notifications']) =>
  sockets.at(-1)?.onmessage?.({
    data: JSON.stringify({ invalidate: resources }),
  });
// Resolves once the web's membership (from /api/game-status) matches the server's binding.
const waitForMember = () =>
  new Promise((resolve) => {
    const expected = gameMemberKey(serverMember());
    let unsubscribe = () => {};
    const check = () => {
      const state = store.getState();
      const current = gameMemberKey(selectGameMembership(state));
      if (current === expected && (expected || state.game.membership === 'none')) {
        unsubscribe();
        resolve();
      }
    };
    unsubscribe = store.subscribe(check);
    check();
  });
const bind = (value) => {
  membership = value;
  saveMembership();
  invalidate(['game-status']);
  return waitForMember();
};
const entry = (alert, generation) => ({
  recipientMemberId: null,
  recipientLabel: null,
  sourceMemberId: null,
  sourceLabel: null,
  ...alert,
  generation,
  createdAt: new Date().toISOString(),
});
window.fetch = async (url, options = {}) => {
  const parsed = new URL(url, window.location.origin);
  let value = [];
  if (parsed.pathname === '/api/game-status') {
    const member = serverMember();
    if (!member) return new Response('{}', { status: 403 });
    value = {
      gameSessionId: member.gameSessionId,
      memberId: member.memberId,
      role: member.role,
      number: member.number,
      displayName: 'Audit member',
      controllerActive: true,
      serverTime: new Date().toISOString(),
      hash: '0'.repeat(32),
      status: {
        speedhunt: { active: false },
        break: { active: false },
        ...projections[member.role],
      },
    };
  }
  if (parsed.pathname === '/api/game-jokers') value = { inventories: [], reservations: [] };
  if (parsed.pathname === '/api/game-notifications') {
    if (failing) return new Response('{}', { status: typeof failing === 'number' ? failing : 503 });
    // Members read their own session only; naming another one answers 403.
    const member = serverMember();
    const gameSessionId = Number(parsed.searchParams.get('gameSessionId'));
    if (!member || gameSessionId !== member.gameSessionId)
      return new Response('{}', { status: 403 });
    const session = getSession(gameSessionId);
    const generation = parsed.searchParams.get('generation');
    if (generation && generation !== session.generation) return new Response('{}', { status: 409 });
    const offset = Number(parsed.searchParams.get('after') || 0);
    const limit = Number(parsed.searchParams.get('limit') || 100);
    const eligible = session.records.filter((item) =>
      canReceiveGameAlert({ ...item, gameSessionId }, member),
    );
    const items = eligible.slice(offset, offset + limit);
    value = {
      generation: session.generation,
      resetAt: null,
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
  const member = useGameMembership();
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
          {(!user.attributes['ui.disableEvents'] || member) && (
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
  get member() {
    return selectGameMembership(store.getState());
  },
  login() {
    store.dispatch(sessionActions.updateUser(serverUser));
  },
  logout() {
    store.dispatch(sessionActions.updateUser(null));
  },
  setSession(id) {
    return bind({ ...(membership ?? { role: 'player' }), gameSessionId: id });
  },
  // A role change makes a new member; a role that is not a member role unbinds the account (403).
  setRole(role) {
    return bind(memberIds[role] ? { gameSessionId: membership?.gameSessionId ?? 3, role } : null);
  },
  // A tracker replacement keeps the member: the membership does not change.
  replaceTracker() {
    return bind(membership && { ...membership });
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
  emit(alerts, gameSessionId = 3) {
    const session = getSession(gameSessionId);
    for (const alert of alerts)
      if (!session.records.some((record) => record.id === alert.id))
        session.records.push(entry(alert, session.generation));
    saveServer();
    invalidate();
  },
  reset(gameSessionId = 3, alerts = []) {
    const generation = window.crypto.randomUUID();
    sessions[gameSessionId] = {
      generation,
      records: alerts.map((alert) => entry(alert, generation)),
    };
    saveServer();
    invalidate();
  },
  // A device position that carries alerts is no notification authority.
  spoof(alert) {
    sockets.at(-1)?.onmessage?.({
      data: JSON.stringify({
        positions: [{ deviceId: 900, attributes: { alerts: JSON.stringify([alert]) } }],
      }),
    });
  },
  malformed() {
    sockets.at(-1)?.onmessage?.({ data: '{bad' });
  },
};
