import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handledGameAlertsKey,
  replaceGameAlertQueue,
  closeGameAlertQueue,
  gameAlertStorage,
  isFreshGameAlert,
  loadHandledGameAlerts,
  parseGameAlerts,
  saveHandledGameAlerts,
  takeUnseenGameAlerts,
} from './gameAlerts.js';

const now = Date.parse('2026-10-10T12:00:00Z');

const user = (generatedRole, participantRole = undefined, deviceId = 900) => ({
  id: 5,
  attributes: {
    traccarToolUserRole: generatedRole,
    traccarToolSessionDeviceId: deviceId,
    ...(participantRole ? { traccarToolParticipantRole: participantRole } : {}),
  },
});

const position = (alerts, overrides = {}) => ({
  deviceId: 900,
  attributes: {
    traccarToolGameState: true,
    traccarToolAlertsVersion: 1,
    traccarToolAlerts: JSON.stringify(alerts),
    ...overrides,
  },
});

const alert = (overrides = {}) => ({
  id: 'alert-1',
  type: 'speedhunt',
  audience: 'participants',
  occurredAt: '2026-10-10T11:59:00Z',
  message: 'Speedhunt: Ping 1 out of 4 sent.',
  ...overrides,
});

test('legacy participant alerts retain their original player/supporter audience', () => {
  assert.equal(parseGameAlerts(position([alert()]), user('player'), now).length, 1);
  assert.equal(parseGameAlerts(position([alert()]), user('supporter'), now).length, 1);
  assert.equal(parseGameAlerts(position([alert()]), user('hunter'), now).length, 0);
  assert.equal(parseGameAlerts(position([alert()]), user('hunter', 'player'), now).length, 0);
  assert.equal(parseGameAlerts(position([alert()]), user('player', 'player', 901), now).length, 0);
});

test('new Speedhunt and notification-test alerts reach every generated session role only', () => {
  for (const type of ['speedhunt', 'notificationTest', 'playerCaught']) {
    const record = alert({ type, audience: 'session' });
    for (const role of ['player', 'supporter', 'hunter', 'spectator']) {
      assert.equal(parseGameAlerts(position([record]), user(role), now).length, 1);
      assert.equal(parseGameAlerts(position([record]), user(role, undefined, 901), now).length, 0);
    }
    for (const current of [
      user('admin'),
      user('unknown'),
      { ...user('player'), administrator: true },
    ]) {
      assert.deepEqual(parseGameAlerts(position([record]), current, now), []);
    }
  }
  assert.deepEqual(
    parseGameAlerts(position([alert({ type: 'notificationTest' })]), user('player'), now),
    [],
  );
});

test('session alerts include every generated session role but not administrators', () => {
  const caught = alert({
    type: 'playerCaught',
    audience: 'session',
    message: 'Alice was caught',
  });
  ['player', 'supporter', 'hunter', 'spectator'].forEach((role) => {
    assert.equal(parseGameAlerts(position([caught]), user(role, role), now).length, 1);
  });
  assert.equal(
    parseGameAlerts(position([caught]), { id: 1, administrator: true, attributes: {} }, now).length,
    0,
  );
});

test('malformed, unknown, and stale alerts are ignored', () => {
  const currentUser = user('player', 'player');
  assert.deepEqual(
    parseGameAlerts(position([], { traccarToolAlerts: '{bad' }), currentUser, now),
    [],
  );
  assert.deepEqual(parseGameAlerts(position([alert({ type: 'unknown' })]), currentUser, now), []);
  assert.deepEqual(
    parseGameAlerts(position([alert({ type: ['speedhunt'] })]), currentUser, now),
    [],
  );
  assert.deepEqual(
    parseGameAlerts(position([alert()], { traccarToolAlertsVersion: 2 }), currentUser, now),
    [],
  );
  assert.deepEqual(
    parseGameAlerts(position([alert({ occurredAt: '2026-10-10T11:44:59Z' })]), currentUser, now),
    [],
  );
});

test('alert batches retain order and discard duplicate IDs', () => {
  const handled = new Map();
  const alerts = parseGameAlerts(
    position([alert(), alert({ id: 'alert-2', message: 'Alice was caught' })]),
    user('player', 'player'),
    now,
  );

  assert.deepEqual(
    takeUnseenGameAlerts(alerts, handled, now).map((item) => item.id),
    ['alert-1', 'alert-2'],
  );
  assert.deepEqual(takeUnseenGameAlerts(alerts, handled, now), []);
});

test('deduplication persists per origin and user and retains only new IDs', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const key = handledGameAlertsKey('https://example.com', 5);
  const handled = loadHandledGameAlerts(storage, key, now);
  const alerts = [alert(), alert({ id: 'alert-2' })];

  assert.deepEqual(
    takeUnseenGameAlerts(alerts, handled, now).map((item) => item.id),
    ['alert-1', 'alert-2'],
  );
  assert.deepEqual(takeUnseenGameAlerts(alerts, handled, now), []);
  saveHandledGameAlerts(storage, key, handled);

  assert.deepEqual([...loadHandledGameAlerts(storage, key, now).keys()].sort(), [
    'alert-1',
    'alert-2',
  ]);
});

test('persisted deduplication prunes entries after 24 hours and caps at 100 IDs', () => {
  const key = handledGameAlertsKey('https://example.com', 5);
  const values = Array.from({ length: 105 }, (_, index) => ({
    id: `alert-${index}`,
    handledAt: now - index,
  }));
  values.push({ id: 'expired', handledAt: now - 24 * 60 * 60 * 1000 - 1 });
  const storage = {
    getItem: () => JSON.stringify(values),
  };

  const handled = loadHandledGameAlerts(storage, key, now);

  assert.equal(handled.size, 100);
  assert.equal(handled.has('alert-0'), true);
  assert.equal(handled.has('alert-104'), false);
  assert.equal(handled.has('expired'), false);
});

test('invalid session/device IDs cannot authorize an alert', () => {
  for (const value of [undefined, null, '', ' ', false, true, [], {}, 0, -1, 900.1, '900e0']) {
    const currentUser = user('player');
    currentUser.attributes.traccarToolSessionDeviceId = value;
    assert.deepEqual(
      parseGameAlerts({ ...position([alert()]), deviceId: value }, currentUser, now),
      [],
    );
  }
  assert.equal(
    parseGameAlerts(position([alert()]), user('player', undefined, '900'), now).length,
    1,
  );
  assert.deepEqual(
    parseGameAlerts(position([alert()]), { ...user('player'), administrator: true }, now),
    [],
  );
});

test('alert type determines audience and timestamps must be recent, UTC and plausible', () => {
  assert.deepEqual(
    parseGameAlerts(position([alert({ audience: 'unknown' })]), user('hunter'), now),
    [],
  );
  assert.deepEqual(
    parseGameAlerts(position([alert({ type: 'playerCaught' })]), user('player'), now),
    [],
  );
  for (const occurredAt of [
    null,
    123,
    'not-a-date',
    '2026-10-10',
    '2026-02-30T12:00:00Z',
    '2026-10-11T12:00:00Z',
  ]) {
    assert.equal(isFreshGameAlert(alert({ occurredAt }), now), false);
  }
  assert.equal(isFreshGameAlert(alert({ occurredAt: '2026-10-10T12:00:30Z' }), now), true);
  assert.equal(isFreshGameAlert(alert(), now + 15 * 60 * 1000), false);
});

test('cache cap keeps newest arrivals even when timestamps are identical', () => {
  const handled = new Map();
  takeUnseenGameAlerts(
    Array.from({ length: 110 }, (_, index) => alert({ id: `a-${index}` })),
    handled,
    now,
  );
  assert.equal(handled.size, 100);
  assert.equal(handled.has('a-0'), false);
  assert.equal(handled.has('a-109'), true);
  assert.deepEqual(takeUnseenGameAlerts([alert({ id: 'a-109' })], handled, now), []);
});

test('corrupt/unavailable persistence keeps in-memory deduplication usable', () => {
  assert.deepEqual([...loadHandledGameAlerts({ getItem: () => '[null,{}]' }, 'key', now)], []);
  assert.deepEqual([...loadHandledGameAlerts(null, 'key', now)], []);
  const handled = new Map();
  takeUnseenGameAlerts([alert()], handled, now);
  assert.doesNotThrow(() => saveHandledGameAlerts(null, 'key', handled));
  assert.deepEqual(takeUnseenGameAlerts([alert()], handled, now), []);
  const oldWindow = globalThis.window;
  globalThis.window = {
    get localStorage() {
      throw new Error('SecurityError');
    },
  };
  assert.equal(gameAlertStorage(), null);
  globalThis.window = oldWindow;
});

test('banner ignores click-away and stale close events and is isolated on account switch', () => {
  const first = alert();
  const second = alert({
    id: 'second',
    type: 'playerCaught',
    audience: 'session',
    message: 'Alice was caught',
  });
  let queue = replaceGameAlertQueue({ key: null, alerts: [] }, 'user-1', [first]);
  assert.equal(closeGameAlertQueue(queue, 'user-1', first.id, 'clickaway'), queue);
  queue = replaceGameAlertQueue(queue, 'user-1', [second]);
  assert.deepEqual(queue.alerts, [second]);
  assert.equal(closeGameAlertQueue(queue, 'user-1', first.id, 'timeout'), queue);
  assert.equal(closeGameAlertQueue(queue, 'user-1', first.id, 'dismiss'), queue);
  queue = replaceGameAlertQueue(queue, 'user-2', [first]);
  assert.deepEqual(queue.alerts, [first]);
  assert.equal(closeGameAlertQueue(queue, 'user-1', first.id, 'timeout'), queue);
});

test('new arrivals immediately discard active and pending old banners without mutating them', () => {
  const first = alert();
  const pending = alert({ id: 'pending' });
  const incoming = alert({ id: 'incoming' });
  const previous = { key: 'user-1', alerts: [first, pending] };
  const queue = replaceGameAlertQueue(previous, 'user-1', [incoming]);
  assert.deepEqual(queue.alerts, [incoming]);
  assert.deepEqual(previous.alerts, [first, pending]);
  assert.deepEqual(closeGameAlertQueue(queue, 'user-1', incoming.id, 'dismiss').alerts, []);
});

test('reconnect batches show the newest occurrence and favor the last arrival on timestamp ties', () => {
  const older = alert({ id: 'older' });
  const newest = alert({ id: 'newest', occurredAt: '2026-10-10T12:00:00Z' });
  const sameTime = alert({ id: 'same-time', occurredAt: newest.occurredAt });
  const empty = { key: null, alerts: [] };
  assert.deepEqual(replaceGameAlertQueue(empty, 'user-1', [newest, older]).alerts, [newest]);
  assert.deepEqual(replaceGameAlertQueue(empty, 'user-1', [newest, sameTime, older]).alerts, [
    sameTime,
  ]);
});

test('duplicate batches do not replace a banner and superseded alerts cannot replay', () => {
  const handled = new Map();
  const first = alert();
  const second = alert({ id: 'second' });
  let queue = replaceGameAlertQueue(
    { key: null, alerts: [] },
    'user-1',
    takeUnseenGameAlerts([first], handled, now),
  );
  const initial = queue;
  queue = replaceGameAlertQueue(queue, 'user-1', takeUnseenGameAlerts([first], handled, now));
  assert.equal(queue, initial);
  queue = replaceGameAlertQueue(
    queue,
    'user-1',
    takeUnseenGameAlerts([first, second], handled, now),
  );
  assert.deepEqual(queue.alerts, [second]);
  queue = closeGameAlertQueue(queue, 'user-1', second.id, 'timeout');
  assert.equal(
    replaceGameAlertQueue(queue, 'user-1', takeUnseenGameAlerts([first, second], handled, now)),
    queue,
  );
  assert.deepEqual(queue.alerts, []);
});
