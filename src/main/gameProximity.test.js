import assert from 'node:assert/strict';
import test from 'node:test';
import {
  proximityCircleLabel,
  proximityCircleSessionId,
  validProximityCircle,
} from './gameProximity.js';
import { canReceiveGameAlert, isValidGameAlert } from './gameAlerts.js';
import { sessionActions, sessionReducer } from '../store/session.js';

const user = (role) => ({
  id: 111,
  attributes: {
    traccarToolUserRole: role,
    traccarToolSessionDeviceId: 900,
    traccarToolAssignedDeviceId: 11,
  },
});
const circle = {
  id: 'circle',
  latitude: 47,
  longitude: 8,
  diameterMeters: 500,
  playerCount: 2,
  supporterCount: 1,
  expiresAt: '2026-10-14T12:00:00Z',
};

test('circles are scoped to generated hunters and spectators', () => {
  for (const role of ['hunter', 'spectator'])
    assert.equal(proximityCircleSessionId(user(role)), 900);
  for (const role of ['player', 'supporter'])
    assert.equal(proximityCircleSessionId(user(role)), null);
  assert.equal(proximityCircleSessionId({ ...user('hunter'), administrator: true }), null);
});
test('circles expire locally and contain count labels only', () => {
  const now = Date.parse('2026-10-14T11:59:00Z');
  assert.ok(validProximityCircle(circle, now));
  assert.equal(validProximityCircle(circle, now + 60000), false);
  assert.equal(validProximityCircle({ ...circle, diameterMeters: 0 }, now), false);
  assert.equal(validProximityCircle({ ...circle, latitude: 91 }, now), false);
  assert.equal(proximityCircleLabel(circle), 'Participant proximity: 2 players, 1 supporter');
});
test('entry and separation are personal; consequences reach only hunters and spectators', () => {
  const common = {
    id: 'alert',
    occurredAt: '2026-10-14T10:00:00Z',
    timeZone: 'UTC',
    message: 'Proximity',
    gameStateDeviceId: 900,
  };
  for (const type of ['participantProximityEnter', 'participantProximityExit']) {
    const alert = { ...common, type, audience: 'user', recipientUserId: 111, sourceDeviceId: 11 };
    assert.ok(isValidGameAlert(alert));
    assert.ok(canReceiveGameAlert(alert, user('player')));
    assert.equal(canReceiveGameAlert(alert, { ...user('player'), id: 112 }), false);
  }
  const consequence = { ...common, type: 'participantProximityConsequence', audience: 'hunters' };
  assert.ok(isValidGameAlert(consequence));
  for (const role of ['player', 'supporter', 'hunter', 'spectator']) {
    assert.equal(
      canReceiveGameAlert(consequence, user(role)),
      ['hunter', 'spectator'].includes(role),
    );
  }
  assert.equal(isValidGameAlert({ ...consequence, audience: 'nonHunters' }), false);
});
test('revoking device access purges positions and route history', () => {
  const before = {
    positions: { 11: { deviceId: 11 }, 12: { deviceId: 12 } },
    history: { 11: [[8, 47]], 12: [[8, 48]] },
  };
  const after = sessionReducer(before, sessionActions.pruneDeviceAccess([11]));
  assert.deepEqual(Object.keys(after.positions), ['11']);
  assert.deepEqual(Object.keys(after.history), ['11']);
});
