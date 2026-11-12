import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterLiveDevices,
  filterLivePositions,
  gameMapFilter,
  isMirrorDevice,
  ownTrackerId,
  participantKey,
  shouldClearSelectedDevice,
} from './gameMap.js';
import { devicesActions, devicesReducer } from '../store/devices.js';

const marker = (role, number, mirror = false) => ({
  traccarToolRole: role,
  traccarToolRoleNumber: number,
  ...(mirror ? { traccarToolMirror: true } : {}),
});
const devices = {
  11: { id: 11, category: 'person', attributes: marker('player', 1) },
  12: { id: 12, category: 'person', attributes: marker('player', 1, true) },
  13: { id: 13, category: 'person', attributes: marker('player', 1, true) },
  21: { id: 21, category: 'person', attributes: marker('supporter', 2) },
  22: { id: 22, category: 'person', attributes: marker('supporter', 2, true) },
  31: { id: 31, category: 'person', attributes: marker('hunter', 1) },
  41: { id: 41, category: 'car', attributes: {} },
};

const user = { id: 5, attributes: {} };
const administrator = { id: 1, administrator: true, attributes: {} };
const roster = (caught = []) =>
  [
    { memberId: 101, role: 'player', number: 1, name: 'Anna' },
    { memberId: 102, role: 'supporter', number: 2, name: 'Ben' },
  ].map((item) => ({ ...item, caught: caught.includes(`${item.role}:${item.number}`) }));
// The game store of the signed-in account: the computed status names its membership and roster.
const game = (role, number, caught = [], changes = {}) => ({
  key: '5',
  status: {
    gameSessionId: 3,
    memberId: role === 'player' ? 101 : 200,
    role,
    number,
    hash: '0123456789abcdef0123456789abcdef',
    status: ['player', 'supporter'].includes(role)
      ? { participantOverview: roster(caught) }
      : { participants: roster(caught) },
    ...changes,
  },
});
const visible = (filterUser, filterGame) =>
  Object.keys(filterLiveDevices(devices, gameMapFilter(filterUser, filterGame)));

test('participant identity uses role markers and never numeric category fallback', () => {
  assert.equal(participantKey(devices[11]), 'player:1');
  assert.equal(participantKey(devices[21]), 'supporter:2');
  assert.equal(participantKey(devices[31]), null);
  assert.equal(participantKey({ category: '1', attributes: { traccarToolRole: 'player' } }), null);
  assert.equal(isMirrorDevice(devices[12]), true);
  assert.equal(isMirrorDevice(devices[11]), false);
});

test('caught participants are hidden with their mirrors for every member role', () => {
  for (const [role, number] of [
    ['player', 1],
    ['supporter', 2],
    ['hunter', 1],
    ['spectator', 1],
  ]) {
    assert.deepEqual(
      visible(user, game(role, number, ['player:1', 'supporter:2'])),
      ['31', '41'],
      role,
    );
  }
  assert.deepEqual(visible(user, game('hunter', 1, ['supporter:2'])), [
    '11',
    '12',
    '13',
    '31',
    '41',
  ]);
});

test('hunters are never catchable participants', () => {
  const hunterCaught = game('spectator', 1);
  hunterCaught.status.status.participants.push({
    memberId: 300,
    role: 'hunter',
    number: 1,
    caught: true,
  });
  assert.deepEqual(visible(user, hunterCaught), ['11', '12', '13', '21', '22', '31', '41']);
});

test('an active participant keeps their real tracker and hides every own outgoing mirror', () => {
  assert.deepEqual(visible(user, game('player', 1)), ['11', '21', '22', '31', '41']);
  assert.deepEqual(visible(user, game('supporter', 2)), ['11', '12', '13', '21', '31', '41']);
  assert.deepEqual(
    visible(user, game('hunter', 1)),
    ['11', '12', '13', '21', '22', '31', '41'],
    'hunters have no own participant mirrors to hide',
  );
});

test('administrators and accounts without known membership see the map unfiltered', () => {
  const all = ['11', '12', '13', '21', '22', '31', '41'];
  const caught = ['player:1', 'supporter:2'];
  assert.deepEqual(visible(administrator, { ...game('player', 1, caught), key: null }), all);
  assert.equal(gameMapFilter(administrator, game('player', 1, caught)), null);
  assert.deepEqual(visible(user, { key: '5', status: null }), all, 'no membership (403)');
  assert.deepEqual(visible(user, { key: null, status: null }), all, 'before the first status');
  assert.deepEqual(
    visible(user, { ...game('player', 1, caught), key: '6' }),
    all,
    'another account',
  );
  assert.deepEqual(
    visible(user, game('player', 1, caught, { memberId: 0 })),
    all,
    'an invalid status names no membership',
  );
});

test('user attributes carry no membership', () => {
  const legacy = {
    ...user,
    attributes: {
      traccarToolUserRole: 'player',
      traccarToolParticipantRole: 'player',
      traccarToolParticipantNumber: 1,
      traccarToolSessionDeviceId: 900,
    },
  };
  assert.equal(gameMapFilter(legacy, { key: '5', status: null }), null);
});

test('malformed roster entries are ignored', () => {
  const malformed = game('player', 1);
  malformed.status.status.participantOverview = [
    { memberId: 101, role: 'player', number: 0, caught: true },
    { memberId: 102, role: 'supporter', number: 2, caught: 'yes' },
    { memberId: 103, role: 'player', number: '1.5', caught: true },
    null,
  ];
  assert.deepEqual(visible(user, malformed), ['11', '21', '22', '31', '41']);
  const missing = game('hunter', 1);
  delete missing.status.status.participants;
  assert.deepEqual(visible(user, missing), ['11', '12', '13', '21', '22', '31', '41']);
});

test('live positions and selection follow the visible device collection', () => {
  const positions = {
    11: { deviceId: 11 },
    12: { deviceId: 12 },
    21: { deviceId: 21 },
    31: { deviceId: 31 },
  };
  const shown = filterLiveDevices(devices, gameMapFilter(user, game('player', 1, ['player:1'])));
  assert.deepEqual(
    filterLivePositions(positions, shown).map((position) => position.deviceId),
    [21, 31],
  );
  assert.equal(shouldClearSelectedDevice(11, shown), true);
  assert.equal(shouldClearSelectedDevice(21, shown), false);
  assert.equal(shouldClearSelectedDevice(null, shown), false);
});

test('the own real tracker is found by its role marker, never a mirror', () => {
  assert.equal(ownTrackerId(devices, { role: 'player', number: 1 }), 11);
  assert.equal(ownTrackerId(devices, { role: 'supporter', number: 2 }), 21);
  assert.equal(ownTrackerId({ 12: devices[12] }, { role: 'player', number: 1 }), null);
  assert.equal(ownTrackerId(devices, { role: 'hunter', number: 1 }), null);
  assert.equal(ownTrackerId(devices, null), null);
});

test('devices are stored as the server sends them and filtering does not mutate its input', () => {
  let state = devicesReducer(undefined, devicesActions.refresh(Object.values(devices)));
  assert.equal(state.loaded, true);
  assert.deepEqual(Object.keys(state.items), ['11', '12', '13', '21', '22', '31', '41']);
  assert.equal(state.gameStateIds, undefined, 'there is no hidden game-state device');
  state = devicesReducer(state, devicesActions.remove(41));
  assert.equal(state.items[41], undefined);

  const accessible = { ...devices };
  filterLiveDevices(accessible, gameMapFilter(user, game('player', 1, ['player:1'])));
  assert.deepEqual(Object.keys(accessible), ['11', '12', '13', '21', '22', '31', '41']);
});
