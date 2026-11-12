import assert from 'node:assert/strict';
import test from 'node:test';
import {
  proximityCircleLabel,
  readsProximityAccess,
  readsProximityCircles,
  validProximityCircle,
} from './gameProximity.js';
import { canReceiveGameAlert, isValidGameAlert } from './gameAlerts.js';
import { sessionActions, sessionReducer } from '../store/session.js';

// The membership /api/game-status names; user attributes play no part.
const member = (role, changes = {}) => ({
  userId: 111,
  gameSessionId: 3,
  memberId: 40,
  role,
  number: 1,
  ...changes,
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

test('circles are read by session hunters and spectators, access by players and supporters', () => {
  for (const role of ['hunter', 'spectator']) {
    assert.equal(readsProximityCircles(member(role)), true);
    assert.equal(readsProximityAccess(member(role)), false);
  }
  for (const role of ['player', 'supporter']) {
    assert.equal(readsProximityCircles(member(role)), false);
    assert.equal(readsProximityAccess(member(role)), true);
  }
  assert.equal(
    readsProximityCircles(null),
    false,
    'administrators and accounts without membership',
  );
  assert.equal(readsProximityAccess(null), false);
});
test('circles expire locally and contain count labels only', () => {
  const now = Date.parse('2026-10-14T11:59:00Z');
  assert.ok(validProximityCircle(circle, now));
  assert.equal(validProximityCircle(circle, now + 60000), false);
  assert.equal(validProximityCircle({ ...circle, diameterMeters: 0 }, now), false);
  assert.equal(validProximityCircle({ ...circle, latitude: 91 }, now), false);
  assert.equal(proximityCircleLabel(circle), 'Participant proximity: 2 players, 1 supporter');
});
test('entry, separation, and sharing starts are personal; group alerts reach only hunters and spectators', () => {
  const common = {
    id: 'alert',
    occurredAt: '2026-10-14T10:00:00Z',
    timeZone: 'UTC',
    message: 'Proximity',
    recipientMemberId: null,
    sourceMemberId: null,
    gameSessionId: 3,
  };
  for (const type of [
    'participantProximityEnter',
    'participantProximityExit',
    'participantProximityConsequence',
  ]) {
    const alert = { ...common, type, audience: 'user', recipientMemberId: 40, sourceMemberId: 40 };
    assert.ok(isValidGameAlert(alert));
    assert.ok(canReceiveGameAlert(alert, member('player')));
    assert.ok(canReceiveGameAlert(alert, member('supporter')));
    assert.equal(canReceiveGameAlert(alert, member('player', { memberId: 41 })), false);
    assert.equal(canReceiveGameAlert(alert, member('player', { gameSessionId: 4 })), false);
    assert.equal(
      isValidGameAlert({
        ...alert,
        audience: 'session',
        recipientMemberId: null,
        sourceMemberId: null,
      }),
      false,
    );
    assert.equal(isValidGameAlert({ ...alert, audience: 'hunters' }), false);
  }
  const consequence = { ...common, type: 'participantProximityConsequence', audience: 'hunters' };
  assert.ok(isValidGameAlert(consequence));
  for (const role of ['player', 'supporter', 'hunter', 'spectator']) {
    assert.equal(
      canReceiveGameAlert(consequence, member(role)),
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
