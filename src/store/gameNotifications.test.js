import assert from 'node:assert/strict';
import test from 'node:test';
import { configureStore } from '@reduxjs/toolkit';
import {
  gameNotificationsActions as actions,
  gameNotificationsReducer,
  emptyGameNotificationState,
} from './gameNotifications.js';
import { sessionActions, sessionReducer } from './session.js';
import { gameActions, gameReducer } from './game.js';
import { createGameNotificationsMiddleware } from './gameNotificationsMiddleware.js';
const generation = '12345678-1234-1234-1234-123456789abc';
const user = { id: 5, attributes: {} };
// Membership comes from the computed game status, never from user attributes.
const status = (changes = {}) => ({
  gameSessionId: 3,
  memberId: 40,
  role: 'spectator',
  number: 1,
  displayName: 'Spectator',
  controllerActive: true,
  serverTime: '2026-10-11T12:00:00Z',
  hash: '0123456789abcdef0123456789abcdef',
  status: {},
  ...changes,
});
const refreshStatus = (changes) =>
  gameActions.refreshStatus({ key: '5', status: status(changes), offsetMs: 0, refreshedAt: 1 });
const item = (id = 'one') => ({
  id,
  type: 'notificationTest',
  audience: 'session',
  message: 'Test',
  occurredAt: '2026-01-01T00:00:00Z',
  timeZone: 'UTC',
  generation,
  gameSessionId: 3,
});
const setup = () => {
  const saved = new Map();
  const store = configureStore({
    reducer: {
      session: sessionReducer,
      game: gameReducer,
      gameNotifications: gameNotificationsReducer,
    },
    middleware: (defaults) =>
      defaults().concat(
        createGameNotificationsMiddleware({
          getOrigin: () => 'https://one.test',
          cache: { save: (key, value) => saved.set(key, structuredClone(value)) },
        }),
      ),
  });
  store.dispatch(sessionActions.updateUser(user));
  store.dispatch(gameActions.reset('5'));
  store.dispatch(refreshStatus());
  store.dispatch(actions.activate({ key: 'scope', generation }));
  const add = (items) =>
    store.dispatch(
      actions.add({
        key: 'scope',
        items,
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
test('a lost membership or another session clears active state and rejects late history writes', () => {
  for (const change of [
    gameActions.noMembership({ key: '5' }),
    refreshStatus({ gameSessionId: 4 }),
    gameActions.reset('6'),
  ]) {
    const { store, add } = setup();
    add([item()]);
    store.dispatch(change);
    assert.deepEqual(store.getState().gameNotifications, emptyGameNotificationState());
    add([item('late')]);
    assert.equal(store.getState().gameNotifications.items.length, 0);
  }
});
test('a role change in the same session prunes what the new member may not keep', () => {
  const { store, add } = setup();
  const live = {
    ...item('live'),
    type: 'livePingReceived',
    audience: 'liveSpectator',
    recipientMemberId: 40,
    sourceMemberId: 20,
  };
  add([item(), live]);
  assert.equal(store.getState().gameNotifications.items.length, 2);
  store.dispatch(refreshStatus({ memberId: 41, role: 'hunter' }));
  assert.equal(store.getState().gameNotifications.key, 'scope');
  assert.deepEqual(
    store.getState().gameNotifications.items.map((entry) => entry.id),
    ['one'],
  );
});
test('an unchanged membership keeps the history', () => {
  const { store, add } = setup();
  add([item()]);
  store.dispatch(refreshStatus({ hash: 'fedcba9876543210fedcba9876543210' }));
  assert.equal(store.getState().gameNotifications.items.length, 1);
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
