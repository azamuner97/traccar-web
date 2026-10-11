import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gameNotificationHistoryKey,
  gameNotificationAccountKey,
  retainGameNotificationHistory,
  formatGameNotificationTime,
  mergeNotificationEntries,
} from './gameNotificationHistory.js';
const generation = '12345678-1234-1234-1234-123456789abc';
const user = {
  id: 5,
  attributes: { traccarToolUserRole: 'hunter', traccarToolSessionDeviceId: 900 },
};
const now = Date.parse('2026-10-11T12:00:00Z');
const alert = (changes = {}) => ({
  id: 'one',
  type: 'speedhunt',
  audience: 'session',
  message: 'message',
  occurredAt: '2026-01-01T12:00:00Z',
  timeZone: 'Europe/Zurich',
  gameStateDeviceId: 900,
  generation,
  read: false,
  ...changes,
});
test('history retains the full generation without 24-hour or 100-entry limits', () => {
  const items = Array.from({ length: 250 }, (_, i) =>
    alert({ id: String(i), occurredAt: new Date(now - (i + 1) * 86400000).toISOString() }),
  );
  assert.equal(retainGameNotificationHistory(items, user, generation, now).length, 250);
});
test('history validates audience, generation and schema and strips unknown metadata', () => {
  const items = retainGameNotificationHistory(
    [
      alert({ privateDevice: 'secret' }),
      alert(),
      alert({ id: 'wrong', generation: 'different' }),
      alert({ id: 'other', gameStateDeviceId: 901 }),
      alert({ id: 'legacy', audience: 'participants' }),
      alert({ id: 'bad', read: 1 }),
    ],
    user,
    generation,
    now,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].privateDevice, undefined);
});
test('cache scope includes origin, user, device and generation', () => {
  const key = gameNotificationHistoryKey('https://one.test', user, generation);
  assert.notEqual(key, gameNotificationHistoryKey('https://two.test', user, generation));
  assert.notEqual(
    key,
    gameNotificationHistoryKey('https://one.test', { ...user, id: 6 }, generation),
  );
  assert.equal(gameNotificationHistoryKey('https://one.test', user, 'bad'), null);
  assert.equal(
    gameNotificationAccountKey('https://one.test', { ...user, administrator: true }),
    null,
  );
});
test('date formatting respects midnight and DST and keeps native events navigable', () => {
  assert.equal(
    formatGameNotificationTime(alert({ occurredAt: '2026-10-10T22:05:06Z' })),
    '11.10.2026 00:05:06 (Europe/Zurich)',
  );
  assert.equal(
    formatGameNotificationTime(alert({ occurredAt: '2026-03-29T01:00:00Z' })),
    '29.03.2026 03:00:00 (Europe/Zurich)',
  );
  assert.equal(
    mergeNotificationEntries([{ id: 7, eventTime: '2026-02-01T00:00:00Z' }], [alert()])[0].kind,
    'event',
  );
});
