import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReceiveGameAlert,
  gameAlertSessionDeviceId,
  isFreshGameAlert,
  isGameAlertInWindow,
  isValidGameAlert,
  gameAlertDurationMs,
  replaceGameAlertQueue,
  closeGameAlertQueue,
} from './gameAlerts.js';
const now = Date.parse('2026-10-11T12:00:00Z');
const user = (role = 'player', device = 900) => ({
  id: 5,
  attributes: {
    traccarToolUserRole: role,
    traccarToolSessionDeviceId: device,
    ...(role === 'spectator' ? {} : { traccarToolAssignedDeviceId: 100 }),
  },
});
const alert = (changes = {}) => ({
  id: 'one',
  type: 'speedhunt',
  audience: 'session',
  occurredAt: new Date(now).toISOString(),
  timeZone: 'Europe/Zurich',
  message: '[14:00:00] Ping',
  gameStateDeviceId: 900,
  ...changes,
});
test('all three alert types reach every generated role, never administrators or other sessions', () => {
  for (const type of ['speedhunt', 'playerCaught', 'notificationTest']) {
    assert.ok(isValidGameAlert(alert({ type })));
    for (const role of ['player', 'supporter', 'hunter', 'spectator'])
      assert.ok(canReceiveGameAlert(alert({ type }), user(role)));
  }
  for (const invalid of [
    user('admin'),
    user('unknown'),
    user('player', 901),
    { ...user(), administrator: true },
  ])
    assert.equal(canReceiveGameAlert(alert(), invalid), false);
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
        canReceiveGameAlert(value, user(role)),
        ['hunter', 'spectator'].includes(role) === (audience === 'hunters'),
      );
    assert.equal(canReceiveGameAlert(value, user('unknown')), false);
    assert.equal(canReceiveGameAlert(value, user('hunter', 901)), false);
    assert.equal(canReceiveGameAlert(value, { ...user('hunter'), administrator: true }), false);
    assert.equal(isValidGameAlert(alert({ audience, type: 'playerCaught' })), false);
    assert.equal(
      isValidGameAlert(alert({ audience, recipientUserId: 5, sourceDeviceId: 100 })),
      false,
    );
  }
});
test('live recipient records require matching account role and session but not source assignment', () => {
  const audiences = {
    hunter: 'liveHunter',
    player: 'livePlayer',
    supporter: 'liveSupporter',
    spectator: 'liveSpectator',
  };
  for (const [role, audience] of Object.entries(audiences)) {
    for (const type of ['livePingReceived', 'livePingEnded']) {
      const value = alert({ type, audience, recipientUserId: 5, sourceDeviceId: 200 });
      assert.ok(isValidGameAlert(value));
      assert.ok(canReceiveGameAlert(value, user(role)));
      for (const other of Object.keys(audiences))
        assert.equal(canReceiveGameAlert(value, user(other)), other === role);
      assert.equal(canReceiveGameAlert(value, { ...user(role), id: 6 }), false);
      assert.equal(canReceiveGameAlert(value, user(role, 901)), false);
      assert.equal(canReceiveGameAlert(value, { ...user(role), administrator: true }), false);
      assert.equal(isValidGameAlert({ ...value, recipientUserId: undefined }), false);
      assert.equal(isValidGameAlert({ ...value, sourceDeviceId: undefined }), false);
      assert.equal(isValidGameAlert({ ...value, audience: 'user' }), false);
      assert.equal(isValidGameAlert({ ...value, audience: 'session' }), false);
    }
    assert.equal(
      isValidGameAlert(
        alert({
          type: 'livePingTargetsChanged',
          audience,
          recipientUserId: 5,
          sourceDeviceId: 200,
        }),
      ),
      role === 'spectator',
    );
  }
  assert.equal(
    canReceiveGameAlert(
      alert({
        type: 'livePingReceived',
        audience: 'livePlayer',
        recipientUserId: 5,
        sourceDeviceId: 100,
      }),
      user('player'),
    ),
    true,
  );
});
test('targeted geofence exits reach only the assigned account', () => {
  const targeted = alert({
    type: 'geofenceExit',
    audience: 'user',
    recipientUserId: 5,
    sourceDeviceId: 100,
  });
  assert.ok(isValidGameAlert(targeted));
  assert.ok(canReceiveGameAlert(targeted, user('hunter')));
  assert.equal(canReceiveGameAlert(targeted, { ...user('hunter'), id: 6 }), false);
  assert.equal(
    canReceiveGameAlert(targeted, {
      ...user('hunter'),
      attributes: { ...user('hunter').attributes, traccarToolAssignedDeviceId: 101 },
    }),
    false,
  );
  assert.equal(canReceiveGameAlert(targeted, user('spectator')), false);
  assert.equal(
    canReceiveGameAlert(targeted, {
      ...user('spectator'),
      attributes: {
        ...user('spectator').attributes,
        traccarToolAssignedDeviceId: 100,
      },
    }),
    false,
  );
  for (const invalid of [
    { type: 'geofenceExit' },
    { audience: 'user', recipientUserId: 5, sourceDeviceId: 100 },
    { type: 'geofenceExit', audience: 'user', recipientUserId: 5 },
    { type: 'geofenceExit', audience: 'user', recipientUserId: 5, sourceDeviceId: 0 },
    { recipientUserId: null, sourceDeviceId: null },
  ]) {
    assert.equal(isValidGameAlert(alert(invalid)), false);
  }
});
test('live tracking types use the same strict assigned-user audience', () => {
  for (const type of ['liveTrackingStarted', 'liveTrackingStopped', 'liveTrackingTargetsChanged']) {
    const targeted = alert({ type, audience: 'user', recipientUserId: 5, sourceDeviceId: 100 });
    assert.ok(isValidGameAlert(targeted));
    assert.ok(canReceiveGameAlert(targeted, user('player')));
    assert.equal(canReceiveGameAlert(targeted, { ...user('player'), id: 6 }), false);
    assert.equal(isValidGameAlert(alert({ type })), false);
    assert.equal(isValidGameAlert({ ...targeted, sourceDeviceId: 0 }), false);
  }
});
test('invalid session identifiers fail closed', () => {
  for (const id of [
    null,
    true,
    false,
    -1,
    0,
    '900x',
    900.5,
    '900.0',
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.equal(gameAlertSessionDeviceId(user('hunter', id)), null);
  }
  assert.equal(gameAlertSessionDeviceId(user('hunter', '900')), 900);
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
