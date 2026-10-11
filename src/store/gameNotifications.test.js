import assert from 'node:assert/strict';
import test from 'node:test';
import { configureStore } from '@reduxjs/toolkit';
import { gameNotificationsActions, gameNotificationsReducer } from './gameNotifications.js';
import { sessionActions, sessionReducer } from './session.js';
import { createGameNotificationsMiddleware } from './gameNotificationsMiddleware.js';
import { gameNotificationHistoryKey } from '../main/gameNotificationHistory.js';

const now = Date.parse('2026-10-11T12:00:00Z');
const user = {
  id: 5,
  attributes: { traccarToolUserRole: 'player', traccarToolSessionDeviceId: 900 },
};
const alert = (id = 'one', changes = {}) => ({
  id,
  type: 'speedhunt',
  audience: 'participants',
  message: '[14:00:00] Speedhunt: Ping 1 out of 4 sent.',
  occurredAt: new Date(now).toISOString(),
  timeZone: 'Europe/Zurich',
  gameStateDeviceId: 900,
  ...changes,
});

const setup = (values = new Map(), storage = null) => {
  const store = configureStore({
    reducer: { session: sessionReducer, gameNotifications: gameNotificationsReducer },
    middleware: (defaults) =>
      defaults().concat(
        createGameNotificationsMiddleware({
          getOrigin: () => 'https://one.test',
          now: () => now,
          getStorage: () =>
            storage || {
              getItem: (key) => values.get(key),
              setItem: (key, value) => values.set(key, value),
            },
        }),
      ),
  });
  store.dispatch(sessionActions.updateUser(user));
  const key = gameNotificationHistoryKey('https://one.test', user);
  const add = (items) =>
    store.dispatch(
      gameNotificationsActions.add({ key, user: store.getState().session.user, items, now }),
    );
  return { store, key, add, values };
};

test('history marks entries read only when the visible drawer opens, including arrivals while open', () => {
  const { store, key, add } = setup();
  add([alert()]);
  assert.equal(store.getState().gameNotifications.items[0].read, false);
  store.dispatch(gameNotificationsActions.setDrawerVisible({ key, visible: true }));
  assert.equal(store.getState().gameNotifications.items[0].read, true);
  add([alert('two')]);
  assert.equal(store.getState().gameNotifications.items[0].read, true);
  store.dispatch(gameNotificationsActions.setDrawerVisible({ key, visible: false }));
  add([alert('three')]);
  assert.equal(store.getState().gameNotifications.items[0].read, false);
  add([alert('one')]);
  assert.equal(
    store.getState().gameNotifications.items.find((item) => item.id === 'one').read,
    true,
  );
});

test('hydration persists read status without a banner queue, preserving history across logout', () => {
  const { store, key, add, values } = setup();
  add([alert()]);
  store.dispatch(gameNotificationsActions.setDrawerVisible({ key, visible: true }));
  store.dispatch(sessionActions.updateUser(null));
  assert.deepEqual(store.getState().gameNotifications, {
    key: null,
    items: [],
    drawerVisible: false,
  });
  assert.equal(values.size, 1);
  store.dispatch(sessionActions.updateUser(user));
  assert.equal(store.getState().gameNotifications.items[0].read, true);
  assert.equal(store.getState().gameNotifications.drawerVisible, false);
  assert.equal(setup(values).store.getState().gameNotifications.items[0].read, true);
});

test('account, session and role changes isolate history and reject late mutations', () => {
  const { store, key, add } = setup();
  add([alert(), alert('caught', { type: 'playerCaught', audience: 'session' })]);
  store.dispatch(
    sessionActions.updateUser({
      ...user,
      attributes: { ...user.attributes, traccarToolUserRole: 'hunter' },
    }),
  );
  assert.deepEqual(
    store.getState().gameNotifications.items.map((item) => item.id),
    ['caught'],
  );
  store.dispatch(gameNotificationsActions.add({ key, user, now, items: [alert('stale-role')] }));
  assert.deepEqual(
    store.getState().gameNotifications.items.map((item) => item.id),
    ['caught'],
  );
  store.dispatch(sessionActions.updateUser({ ...user, id: 6 }));
  assert.deepEqual(store.getState().gameNotifications.items, []);
  add([alert('late')]);
  store.dispatch(gameNotificationsActions.deleteAll({ key }));
  assert.deepEqual(store.getState().gameNotifications.items, []);
  store.dispatch(sessionActions.updateUser(user));
  assert.equal(store.getState().gameNotifications.items.length, 1);
  store.dispatch(
    sessionActions.updateUser({
      ...user,
      attributes: { ...user.attributes, traccarToolSessionDeviceId: 901 },
    }),
  );
  assert.deepEqual(store.getState().gameNotifications.items, []);
});

test('pruning expires history, and equal-time batches retain the newest 100 IDs stably', () => {
  const { store, key, add } = setup();
  add(Array.from({ length: 105 }, (_, index) => alert(String(index))));
  assert.equal(store.getState().gameNotifications.items.length, 100);
  assert.equal(store.getState().gameNotifications.items[0].id, '104');
  assert.equal(store.getState().gameNotifications.items.at(-1).id, '5');
  store.dispatch(gameNotificationsActions.prune({ key, user, now }));
  assert.equal(store.getState().gameNotifications.items[0].id, '104');
  store.dispatch(gameNotificationsActions.prune({ key, user, now: now + 24 * 60 * 60 * 1000 + 1 }));
  assert.deepEqual(store.getState().gameNotifications.items, []);
});

test('individual deletion and clear-all update local history, not the delivery ID cache', () => {
  const { store, key, add, values } = setup();
  const handledKey = 'traccarToolHandledAlerts:https://one.test:5';
  values.set(handledKey, '[{"id":"one","handledAt":1}]');
  add([alert(), alert('two')]);
  store.dispatch(gameNotificationsActions.delete({ key, id: 'one' }));
  assert.deepEqual(
    store.getState().gameNotifications.items.map((item) => item.id),
    ['two'],
  );
  store.dispatch(gameNotificationsActions.deleteAll({ key }));
  assert.deepEqual(store.getState().gameNotifications.items, []);
  assert.equal(values.get(handledKey), '[{"id":"one","handledAt":1}]');
});

test('blocked storage retains usable in-memory history', () => {
  const { store, add } = setup(undefined, {
    getItem() {
      throw Error('blocked');
    },
    setItem() {
      throw Error('blocked');
    },
  });
  assert.doesNotThrow(() => add([alert()]));
  assert.equal(store.getState().gameNotifications.items.length, 1);
});
