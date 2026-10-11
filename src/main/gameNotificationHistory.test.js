import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatGameNotificationTime,
  gameNotificationHistoryAgeMs,
  gameNotificationHistoryKey,
  loadGameNotificationHistory,
  mergeNotificationEntries,
  retainGameNotificationHistory,
  saveGameNotificationHistory,
} from './gameNotificationHistory.js';
import { isFreshGameAlert, parseGameAlerts } from './gameAlerts.js';

const now = Date.parse('2026-10-11T12:00:00Z');
const user = {
  id: 5,
  attributes: { traccarToolUserRole: 'player', traccarToolSessionDeviceId: 900 },
};
const alert = (changes = {}) => ({
  id: 'one',
  type: 'speedhunt',
  audience: 'participants',
  occurredAt: '2026-10-11T11:00:00Z',
  message: '[13:00:00] Speedhunt: Ping 1 out of 4 sent.',
  timeZone: 'Europe/Zurich',
  gameStateDeviceId: 900,
  read: false,
  ...changes,
});

test('history uses a 24-hour window, independently of live-alert freshness', () => {
  assert.equal(isFreshGameAlert(alert(), now), false);
  assert.equal(retainGameNotificationHistory([alert()], user, now).length, 1);
  assert.deepEqual(
    retainGameNotificationHistory(
      [alert({ occurredAt: new Date(now - gameNotificationHistoryAgeMs - 1).toISOString() })],
      user,
      now,
    ),
    [],
  );
});

test('history validates permissions, timestamps, metadata and read state, whitelisting fields', () => {
  const result = retainGameNotificationHistory(
    [
      null,
      {},
      alert({ id: 'extra', sourcePlayer: 'private', pingKind: 'live' }),
      alert({ id: 'bad', timeZone: 'bad/zone' }),
      alert({ id: 'bad', timeZone: null }),
      alert({ id: 'bad', read: 'false' }),
      alert({ id: 'bad', occurredAt: '2026-02-30T12:00:00Z' }),
      alert({ id: 'bad', occurredAt: new Date(now + 61000).toISOString() }),
      alert({ id: 'bad', gameStateDeviceId: true }),
      alert({ id: 'bad', gameStateDeviceId: 901 }),
      alert({ id: 'bad', type: 'playerCaught' }),
    ],
    user,
    now,
  );
  assert.deepEqual(result, [alert({ id: 'extra' })]);
  assert.deepEqual(
    retainGameNotificationHistory([alert()], { ...user, administrator: true }, now),
    [],
  );
  const hunter = { ...user, attributes: { ...user.attributes, traccarToolUserRole: 'hunter' } };
  assert.deepEqual(retainGameNotificationHistory([alert()], hunter, now), []);
  assert.equal(
    retainGameNotificationHistory(
      [alert({ type: 'playerCaught', audience: 'session' })],
      hunter,
      now,
    ).length,
    1,
  );
});

test('history is newest-first, deduplicated, and bounded to 100 records', () => {
  const records = Array.from({ length: 105 }, (_, index) =>
    alert({
      id: String(index),
      occurredAt: new Date(now - index * 1000).toISOString(),
    }),
  );
  const retained = retainGameNotificationHistory([...records.reverse(), records[0]], user, now);
  assert.equal(retained.length, 100);
  assert.equal(retained[0].id, '0');
  assert.equal(retained.at(-1).id, '99');
});

test('session Speedhunt and test alerts survive history reload for hunters and spectators', () => {
  for (const role of ['hunter', 'spectator']) {
    const current = { ...user, attributes: { ...user.attributes, traccarToolUserRole: role } };
    const records = [
      alert({ id: 'speedhunt', audience: 'session' }),
      alert({ id: 'test', type: 'notificationTest', audience: 'session' }),
      alert({ id: 'caught', type: 'playerCaught', audience: 'session' }),
    ];
    const storage = { getItem: () => JSON.stringify({ version: 1, items: records }) };
    assert.equal(loadGameNotificationHistory(storage, 'key', current, now).length, 3);
    assert.deepEqual(
      retainGameNotificationHistory(
        records,
        {
          ...current,
          attributes: { ...current.attributes, traccarToolSessionDeviceId: 901 },
        },
        now,
      ),
      [],
    );
  }
});

test('storage keys isolate server origin, account and game session', () => {
  const key = gameNotificationHistoryKey('https://one.test', user);
  assert.notEqual(key, gameNotificationHistoryKey('https://two.test', user));
  assert.notEqual(key, gameNotificationHistoryKey('https://one.test', { ...user, id: 6 }));
  assert.notEqual(
    key,
    gameNotificationHistoryKey('https://one.test', {
      ...user,
      attributes: { ...user.attributes, traccarToolSessionDeviceId: 901 },
    }),
  );
  for (const current of [
    null,
    { ...user, id: true },
    { ...user, administrator: true },
    { ...user, attributes: {} },
  ]) {
    assert.equal(gameNotificationHistoryKey('https://one.test', current), null);
  }
});

test('persistence reloads read status, rejects corruption, and tolerates blocked storage', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  const key = gameNotificationHistoryKey('https://one.test', user);
  saveGameNotificationHistory(storage, key, [alert({ read: true })]);
  assert.deepEqual(loadGameNotificationHistory(storage, key, user, now), [alert({ read: true })]);
  values.set(key, '{bad');
  assert.deepEqual(loadGameNotificationHistory(storage, key, user, now), []);
  values.set(key, JSON.stringify({ version: 2, items: [alert()] }));
  assert.deepEqual(loadGameNotificationHistory(storage, key, user, now), []);
  const blocked = {
    getItem: () => {
      throw Error('blocked');
    },
    setItem: () => {
      throw Error('blocked');
    },
  };
  assert.deepEqual(loadGameNotificationHistory(blocked, key, user, now), []);
  assert.doesNotThrow(() => saveGameNotificationHistory(blocked, key, [alert()]));
});

test('history date uses the game timezone at midnight and DST, with UTC for legacy alerts', () => {
  assert.equal(
    formatGameNotificationTime(alert({ occurredAt: '2026-10-10T22:05:06Z' })),
    '11.10.2026 00:05:06 (Europe/Zurich)',
  );
  assert.equal(
    formatGameNotificationTime(alert({ occurredAt: '2026-03-29T00:59:59Z' })),
    '29.03.2026 01:59:59 (Europe/Zurich)',
  );
  assert.equal(
    formatGameNotificationTime(alert({ occurredAt: '2026-03-29T01:00:00Z' })),
    '29.03.2026 03:00:00 (Europe/Zurich)',
  );
  assert.equal(
    formatGameNotificationTime({ occurredAt: '2026-10-10T22:05:06Z' }),
    '10.10.2026 22:05:06 (UTC)',
  );
});

test('live payload accepts additive timezone metadata and legacy alerts, rejecting invalid zones', () => {
  const current = alert({ occurredAt: new Date(now).toISOString() });
  const legacy = { ...current, id: 'legacy' };
  delete legacy.timeZone;
  const position = {
    deviceId: 900,
    attributes: {
      traccarToolGameState: true,
      traccarToolAlertsVersion: 1,
      traccarToolAlerts: JSON.stringify([
        current,
        legacy,
        { ...current, id: 'bad', timeZone: 'Invalid/Zone' },
      ]),
    },
  };
  assert.deepEqual(
    parseGameAlerts(position, user, now).map((item) => item.id),
    ['one', 'legacy'],
  );
});

test('merged history sorts native and game entries without mixing ID namespaces', () => {
  const entries = mergeNotificationEntries(
    [
      { id: 'one', eventTime: '2026-10-11T11:01:00Z' },
      { id: 2, eventTime: '2026-10-11T10:59:00Z' },
    ],
    [alert()],
  );
  assert.deepEqual(
    entries.map((entry) => [entry.kind, entry.item.id]),
    [
      ['event', 'one'],
      ['game', 'one'],
      ['event', 2],
    ],
  );
});
