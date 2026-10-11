import assert from 'node:assert/strict';
import test from 'node:test';
import { configureStore } from '@reduxjs/toolkit';
import {
  gameNotificationsActions as actions,
  gameNotificationsReducer,
  emptyGameNotificationState,
} from './gameNotifications.js';
import { sessionActions, sessionReducer } from './session.js';
import { createGameNotificationsMiddleware } from './gameNotificationsMiddleware.js';
const generation = '12345678-1234-1234-1234-123456789abc';
const user = {
  id: 5,
  attributes: { traccarToolUserRole: 'spectator', traccarToolSessionDeviceId: 900 },
};
const item = (id = 'one') => ({
  id,
  type: 'notificationTest',
  audience: 'session',
  message: 'Test',
  occurredAt: '2026-01-01T00:00:00Z',
  timeZone: 'UTC',
  generation,
  gameStateDeviceId: 900,
});
const setup = () => {
  const saved = new Map();
  const store = configureStore({
    reducer: { session: sessionReducer, gameNotifications: gameNotificationsReducer },
    middleware: (defaults) =>
      defaults().concat(
        createGameNotificationsMiddleware({
          getOrigin: () => 'https://one.test',
          cache: { save: (key, value) => saved.set(key, structuredClone(value)) },
        }),
      ),
  });
  store.dispatch(sessionActions.updateUser(user));
  store.dispatch(actions.activate({ key: 'scope', generation }));
  const add = (items) =>
    store.dispatch(
      actions.add({
        key: 'scope',
        items,
        user,
        cursor: String(items.length),
        now: Date.parse('2026-10-11T12:00:00Z'),
      }),
    );
  return { store, saved, add };
};
test('visible drawer marks records read; hidden arrivals remain unread', () => {
  const { store, add } = setup();
  add([item()]);
  assert.equal(store.getState().gameNotifications.items[0].read, false);
  store.dispatch(actions.setDrawerVisible({ key: 'scope', visible: true }));
  add([item('two')]);
  assert.ok(store.getState().gameNotifications.items.every((entry) => entry.read));
  store.dispatch(actions.setDrawerVisible({ key: 'scope', visible: false }));
  add([item('three')]);
  assert.equal(store.getState().gameNotifications.items[0].read, false);
});
test('deletion and clear-all suppress archive restoration but retain handled IDs', () => {
  const { store, add } = setup();
  add([item()]);
  store.dispatch(actions.delete({ key: 'scope', id: 'one' }));
  add([item()]);
  assert.equal(store.getState().gameNotifications.items.length, 0);
  assert.ok(store.getState().gameNotifications.handled.includes('one'));
  add([item('two')]);
  store.dispatch(actions.deleteAll({ key: 'scope', now: Date.now() }));
  add([item('old')]);
  assert.equal(store.getState().gameNotifications.items.length, 0);
});
test('full history persists and logout only clears active state', () => {
  const { store, saved, add } = setup();
  add(Array.from({ length: 250 }, (_, i) => item(String(i))));
  assert.equal(saved.get('scope').items.length, 250);
  store.dispatch(sessionActions.updateUser(null));
  assert.deepEqual(store.getState().gameNotifications, emptyGameNotificationState());
  assert.equal(saved.get('scope').items.length, 250);
});
test('revoked roles and account changes reject late history writes', () => {
  const { store, add } = setup();
  add([item()]);
  store.dispatch(
    sessionActions.updateUser({
      ...user,
      attributes: { ...user.attributes, traccarToolUserRole: 'unknown' },
    }),
  );
  add([item('late')]);
  assert.equal(store.getState().gameNotifications.items.length, 0);
});
test('a new generation starts with empty read, deletion and deduplication state', () => {
  const { store, add } = setup();
  add([item()]);
  store.dispatch(actions.delete({ key: 'scope', id: 'one' }));
  store.dispatch(
    actions.activate({ key: 'fresh', generation: '87654321-1234-1234-1234-123456789abc' }),
  );
  assert.deepEqual(store.getState().gameNotifications.deleted, []);
  assert.deepEqual(store.getState().gameNotifications.handled, []);
});
