import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReceiveGameAlert,
  gameAlertPermissionKey,
  isFreshGameAlert,
  isGameAlertInWindow,
  isValidGameAlert,
  gameAlertDurationMs,
  replaceGameAlertQueue,
  closeGameAlertQueue,
} from './gameAlerts.js';
const now = Date.parse('2026-10-11T12:00:00Z');
// The membership /api/game-status names (member 40 of game session 3); user attributes play no part.
const member = (role = 'player', gameSessionId = 3, memberId = 40) => ({
  userId: 5,
  gameSessionId,
  memberId,
  role,
  number: 1,
});
// An alert as kept by the web: the server entry stamped with the session of the page that carried it.
const alert = (changes = {}) => ({
  id: 'one',
  type: 'speedhunt',
  audience: 'session',
  occurredAt: new Date(now).toISOString(),
  timeZone: 'Europe/Zurich',
  message: '[14:00:00] Ping',
  recipientMemberId: null,
  sourceMemberId: null,
  gameSessionId: 3,
  ...changes,
});
test('all three alert types reach every member role, never accounts without membership or other sessions', () => {
  for (const type of ['speedhunt', 'playerCaught', 'notificationTest']) {
    assert.ok(isValidGameAlert(alert({ type })));
    for (const role of ['player', 'supporter', 'hunter', 'spectator'])
      assert.ok(canReceiveGameAlert(alert({ type }), member(role)));
  }
  for (const invalid of [
    null,
    member('player', 4),
    member('player', 0),
    { ...member(), memberId: null },
  ])
    assert.equal(canReceiveGameAlert(alert(), invalid), false);
  assert.equal(canReceiveGameAlert(alert({ gameSessionId: undefined }), member()), false);
});
test('the permission key follows role and member', () => {
  assert.equal(gameAlertPermissionKey(null), null);
  assert.equal(gameAlertPermissionKey(member()), gameAlertPermissionKey(member('player', 3, 40)));
  assert.notEqual(gameAlertPermissionKey(member()), gameAlertPermissionKey(member('supporter')));
  assert.notEqual(
    gameAlertPermissionKey(member()),
    gameAlertPermissionKey(member('player', 3, 41)),
  );
});
test('schema rejects legacy audiences, unknown types, invalid fields and timezones', () => {
  for (const changes of [
    { audience: 'participants' },
    { type: 'constructor' },
    { id: '' },
    { message: '' },
    { message: 'x'.repeat(8193) },
    { timeZone: 'Invalid/Zone' },
    { timeZone: null },
    { recipientMemberId: 40 },
    { sourceMemberId: 40 },
  ]) {
    assert.equal(isValidGameAlert(alert(changes)), false);
  }
});
test('named Speedhunt variants reach hunters and spectators while players and supporters receive the anonymous variant', () => {
  for (const audience of ['hunters', 'nonHunters']) {
    const value = alert({ audience });
    assert.ok(isValidGameAlert(value));
    for (const role of ['player', 'supporter', 'hunter', 'spectator'])
      assert.equal(
        canReceiveGameAlert(value, member(role)),
        ['hunter', 'spectator'].includes(role) === (audience === 'hunters'),
      );
    assert.equal(canReceiveGameAlert(value, member('unknown')), false);
    assert.equal(canReceiveGameAlert(value, member('hunter', 4)), false);
    assert.equal(isValidGameAlert(alert({ audience, type: 'playerCaught' })), false);
    assert.equal(
      isValidGameAlert(alert({ audience, recipientMemberId: 40, sourceMemberId: 40 })),
      false,
    );
  }
});
test('live recipient records require the matching member, role and session and another source', () => {
  const audiences = {
    hunter: 'liveHunter',
    player: 'livePlayer',
    supporter: 'liveSupporter',
    spectator: 'liveSpectator',
  };
  for (const [role, audience] of Object.entries(audiences)) {
    for (const type of ['livePingReceived', 'livePingEnded']) {
      const value = alert({ type, audience, recipientMemberId: 40, sourceMemberId: 20 });
      assert.ok(isValidGameAlert(value));
      assert.ok(canReceiveGameAlert(value, member(role)));
      for (const other of Object.keys(audiences))
        assert.equal(canReceiveGameAlert(value, member(other)), other === role);
      assert.equal(canReceiveGameAlert(value, member(role, 3, 41)), false);
      assert.equal(canReceiveGameAlert(value, member(role, 4)), false);
      assert.equal(isValidGameAlert({ ...value, recipientMemberId: null }), false);
      assert.equal(isValidGameAlert({ ...value, sourceMemberId: null }), false);
      assert.equal(isValidGameAlert({ ...value, sourceMemberId: 40 }), false);
      assert.equal(isValidGameAlert({ ...value, audience: 'user' }), false);
      assert.equal(isValidGameAlert({ ...value, audience: 'session' }), false);
    }
    assert.equal(
      isValidGameAlert(
        alert({
          type: 'livePingTargetsChanged',
          audience,
          recipientMemberId: 40,
          sourceMemberId: 20,
        }),
      ),
      role === 'spectator',
    );
  }
});
test('targeted geofence exits reach only the member they are about', () => {
  const targeted = alert({
    type: 'geofenceExit',
    audience: 'user',
    recipientMemberId: 40,
    sourceMemberId: 40,
  });
  assert.ok(isValidGameAlert(targeted));
  assert.ok(canReceiveGameAlert(targeted, member('hunter')));
  assert.equal(canReceiveGameAlert(targeted, member('hunter', 3, 41)), false);
  assert.equal(canReceiveGameAlert(targeted, member('spectator')), false);
  for (const invalid of [
    { type: 'geofenceExit' },
    { audience: 'user', recipientMemberId: 40, sourceMemberId: 40 },
    { type: 'geofenceExit', audience: 'user', recipientMemberId: 40 },
    { type: 'geofenceExit', audience: 'user', recipientMemberId: 40, sourceMemberId: 41 },
    { type: 'geofenceExit', audience: 'user', recipientMemberId: 0, sourceMemberId: 0 },
  ]) {
    assert.equal(isValidGameAlert(alert(invalid)), false);
  }
});
test('live tracking types use the same strict member audience', () => {
  for (const type of ['liveTrackingStarted', 'liveTrackingStopped', 'liveTrackingTargetsChanged']) {
    const targeted = alert({ type, audience: 'user', recipientMemberId: 40, sourceMemberId: 40 });
    assert.ok(isValidGameAlert(targeted));
    assert.ok(canReceiveGameAlert(targeted, member('player')));
    assert.equal(canReceiveGameAlert(targeted, member('player', 3, 41)), false);
    assert.equal(isValidGameAlert(alert({ type })), false);
    assert.equal(isValidGameAlert({ ...targeted, sourceMemberId: 0 }), false);
  }
});
test('archive validation has no expiry, while live alerts expire after 15 minutes', () => {
  assert.equal(
    isFreshGameAlert(alert({ occurredAt: new Date(now - 900001).toISOString() }), now),
    false,
  );
  assert.equal(
    isGameAlertInWindow(alert({ occurredAt: '2020-01-01T00:00:00Z' }), Infinity, now),
    true,
  );
  for (const occurredAt of [
    '2026-02-30T12:00:00Z',
    'not-date',
    '2026-10-11T12:01:01Z',
    '2026-10-11T12:00:00+01:00',
  ]) {
    assert.equal(isGameAlertInWindow(alert({ occurredAt }), Infinity, now), false);
  }
});
test('newest banner overrides immediately, duration is 60 seconds, and late closes are harmless', () => {
  assert.equal(gameAlertDurationMs, 60000);
  const first = replaceGameAlertQueue({ key: null, alerts: [] }, 'scope', [alert()]);
  const second = replaceGameAlertQueue(first, 'scope', [
    alert({ id: 'new', occurredAt: new Date(now + 1000).toISOString() }),
  ]);
  assert.equal(second.alerts[0].id, 'new');
  assert.equal(closeGameAlertQueue(second, 'scope', 'one', 'timeout'), second);
  assert.equal(closeGameAlertQueue(second, 'scope', 'new', 'clickaway'), second);
  assert.deepEqual(closeGameAlertQueue(second, 'scope', 'new', 'close').alerts, []);
});
test('replay batches select by occurrence, equal times choose the last record', () => {
  const result = replaceGameAlertQueue({}, 'scope', [
    alert({ id: 'new', occurredAt: new Date(now + 1).toISOString() }),
    alert(),
  ]);
  assert.equal(result.alerts[0].id, 'new');
  assert.equal(
    replaceGameAlertQueue({}, 'scope', [alert(), alert({ id: 'tie' })]).alerts[0].id,
    'tie',
  );
});
