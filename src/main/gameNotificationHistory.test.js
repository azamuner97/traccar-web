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
// The membership /api/game-status names; user attributes play no part.
const member = { userId: 5, gameSessionId: 3, memberId: 40, role: 'hunter', number: 1 };
const now = Date.parse('2026-10-11T12:00:00Z');
const alert = (changes = {}) => ({
  id: 'one',
  type: 'speedhunt',
  audience: 'session',
  message: 'message',
  occurredAt: '2026-01-01T12:00:00Z',
  timeZone: 'Europe/Zurich',
  gameSessionId: 3,
  generation,
  read: false,
  ...changes,
});
test('history retains the full generation without 24-hour or 100-entry limits', () => {
  const items = Array.from({ length: 250 }, (_, i) =>
    alert({ id: String(i), occurredAt: new Date(now - (i + 1) * 86400000).toISOString() }),
  );
  assert.equal(retainGameNotificationHistory(items, member, generation, now).length, 250);
});
test('history validates audience, generation and schema and strips unknown metadata', () => {
  const items = retainGameNotificationHistory(
    [
      alert({ privateDevice: 'secret' }),
      alert(),
      alert({ id: 'wrong', generation: 'different' }),
      alert({ id: 'other', gameSessionId: 4 }),
      alert({ id: 'unstamped', gameSessionId: undefined }),
      alert({ id: 'legacy', audience: 'participants' }),
      alert({ id: 'bad', read: 1 }),
    ],
    member,
    generation,
    now,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].privateDevice, undefined);
});
test('history keeps this member targeted fields and rejects another recipient', () => {
  const targeted = alert({
    id: 'exit',
    type: 'geofenceExit',
    audience: 'user',
    recipientMemberId: 40,
    sourceMemberId: 40,
    recipientLabel: 'Hunter One',
  });
  const items = retainGameNotificationHistory(
    [
      targeted,
      { ...targeted, id: 'other', recipientMemberId: 41, sourceMemberId: 41 },
      { ...targeted, id: 'mixed', sourceMemberId: 41 },
    ],
    member,
    generation,
    now,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].recipientMemberId, 40);
  assert.equal(items[0].sourceMemberId, 40);
  assert.equal(items[0].recipientLabel, undefined, 'label snapshots are not kept');
});
test('cache scope includes origin, account, game session and generation', () => {
  const key = gameNotificationHistoryKey('https://one.test', member, generation);
  assert.notEqual(key, gameNotificationHistoryKey('https://two.test', member, generation));
  assert.notEqual(
    key,
    gameNotificationHistoryKey('https://one.test', { ...member, userId: 6 }, generation),
  );
  assert.notEqual(
    key,
    gameNotificationHistoryKey('https://one.test', { ...member, gameSessionId: 4 }, generation),
  );
  assert.equal(gameNotificationHistoryKey('https://one.test', member, 'bad'), null);
  assert.equal(gameNotificationAccountKey('https://one.test', null), null, 'no membership');
  assert.equal(
    gameNotificationAccountKey('https://one.test', { ...member, gameSessionId: 0 }),
    null,
  );
});
test('recipient history persists source and member fields and revalidates the current member and role', () => {
  const received = alert({
    type: 'livePingReceived',
    audience: 'liveHunter',
    recipientMemberId: 40,
    sourceMemberId: 20,
  });
  const items = retainGameNotificationHistory([received], member, generation, now);
  assert.deepEqual(items, [received]);
  assert.equal(
    retainGameNotificationHistory(items, { ...member, role: 'player' }, generation, now).length,
    0,
  );
  assert.equal(
    retainGameNotificationHistory(items, { ...member, memberId: 41 }, generation, now).length,
    0,
    'a role change makes a new member without the personal history',
  );
  assert.equal(
    retainGameNotificationHistory([{ ...received, sourceMemberId: 40 }], member, generation, now)
      .length,
    0,
    'a live recipient is never their own source',
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
