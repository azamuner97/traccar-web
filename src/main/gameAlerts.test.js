import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handledGameAlertsKey,
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

test('participant alerts are visible only to players and supporters in the session', () => {
  assert.equal(parseGameAlerts(position([alert()]), user('player'), now).length, 1);
  assert.equal(parseGameAlerts(position([alert()]), user('supporter'), now).length, 1);
  assert.equal(parseGameAlerts(position([alert()]), user('hunter'), now).length, 0);
  assert.equal(parseGameAlerts(position([alert()]), user('hunter', 'player'), now).length, 0);
  assert.equal(parseGameAlerts(position([alert()]), user('player', 'player', 901), now).length, 0);
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
