import assert from 'node:assert/strict';
import test from 'node:test';

import {
  caughtParticipantKeys,
  filterLiveDevices,
  filterLivePositions,
  isOwnParticipantMirror,
  participantKey,
  participantUserKey,
  shouldClearSelectedDevice,
} from './gameState.js';
import { devicesActions, devicesReducer } from '../store/devices.js';

const statePosition = (caught, overrides = {}) => ({
  deviceId: 900,
  attributes: {
    traccarToolGameStateVersion: 1,
    traccarToolGameState: true,
    traccarToolCaughtParticipants: caught,
    ...overrides,
  },
});

const devices = {
  11: {
    id: 11,
    category: 'person',
    attributes: { traccarToolRole: 'player', traccarToolRoleNumber: 1 },
  },
  12: {
    id: 12,
    category: 'person',
    attributes: {
      traccarToolRole: 'player',
      traccarToolRoleNumber: 1,
      traccarToolMirror: true,
    },
  },
  13: {
    id: 13,
    category: 'person',
    attributes: {
      traccarToolRole: 'player',
      traccarToolRoleNumber: 1,
      traccarToolMirror: true,
    },
  },
  21: {
    id: 21,
    category: 'person',
    attributes: { traccarToolRole: 'supporter', traccarToolRoleNumber: 2 },
  },
  22: {
    id: 22,
    category: 'person',
    attributes: {
      traccarToolRole: 'supporter',
      traccarToolRoleNumber: 2,
      traccarToolMirror: true,
    },
  },
  31: {
    id: 31,
    category: 'person',
    attributes: { traccarToolRole: 'hunter', traccarToolRoleNumber: 1 },
  },
  900: { id: 900, attributes: { traccarToolGameState: true } },
};

const gameStateIds = { 900: true };
const playerUser = {
  attributes: {
    traccarToolParticipantRole: 'player',
    traccarToolParticipantNumber: 1,
  },
};
const supporterUser = {
  attributes: {
    traccarToolParticipantRole: 'supporter',
    traccarToolParticipantNumber: 2,
  },
};
const administrator = { administrator: true };

test('participant identity uses role attributes and never numeric category fallback', () => {
  assert.equal(participantKey(devices[11]), 'player:1');
  assert.equal(participantKey(devices[21]), 'supporter:2');
  assert.equal(participantKey(devices[31]), null);
  assert.equal(participantKey({ category: '1', attributes: { traccarToolRole: 'player' } }), null);
});

test('participant user identity requires a supported role and positive integer', () => {
  assert.equal(participantUserKey(playerUser), 'player:1');
  assert.equal(participantUserKey(supporterUser), 'supporter:2');
  assert.equal(participantUserKey({ attributes: {} }), null);
  assert.equal(
    participantUserKey({
      attributes: {
        traccarToolParticipantRole: 'hunter',
        traccarToolParticipantNumber: 1,
      },
    }),
    null,
  );
  for (const number of [0, -1, 1.5, '0', '-1', '1.5', '', null]) {
    assert.equal(
      participantUserKey({
        attributes: {
          traccarToolParticipantRole: 'player',
          traccarToolParticipantNumber: number,
        },
      }),
      null,
    );
  }
});

test('own-participant matching requires the explicit mirror marker', () => {
  assert.equal(isOwnParticipantMirror(devices[11], playerUser), false);
  assert.equal(isOwnParticipantMirror(devices[12], playerUser), true);
  assert.equal(isOwnParticipantMirror(devices[22], playerUser), false);
});

test('caught-state parsing accepts empty and duplicate valid tokens', () => {
  assert.deepEqual([...caughtParticipantKeys({ 900: statePosition('') }, gameStateIds)], []);
  assert.deepEqual(
    [
      ...caughtParticipantKeys(
        { 900: statePosition('player:1,player:1,supporter:2') },
        gameStateIds,
      ),
    ],
    ['player:1', 'supporter:2'],
  );
});

test('malformed, unsupported, and untrusted caught state fails open', () => {
  assert.equal(caughtParticipantKeys({}, gameStateIds).size, 0);
  assert.equal(caughtParticipantKeys({ 900: statePosition('player:1,bad') }, gameStateIds).size, 0);
  assert.equal(
    caughtParticipantKeys(
      { 900: statePosition('player:1', { traccarToolGameStateVersion: 2 }) },
      gameStateIds,
    ).size,
    0,
  );
  assert.equal(
    caughtParticipantKeys(
      { 900: statePosition('player:1', { traccarToolGameState: false }) },
      gameStateIds,
    ).size,
    0,
  );
  assert.equal(
    caughtParticipantKeys({ 901: { ...statePosition('player:1'), deviceId: 901 } }, gameStateIds)
      .size,
    0,
  );
});

test('caught filtering removes every real and mirrored participant instance', () => {
  const positions = { 900: statePosition('player:1,supporter:2') };
  const visible = filterLiveDevices(devices, positions, gameStateIds, playerUser);

  assert.deepEqual(Object.keys(visible), ['31']);
});

test('caught filtering never treats hunters as catchable participants', () => {
  const positions = { 900: statePosition('hunter:1') };
  const visible = filterLiveDevices(devices, positions, gameStateIds, {});

  assert.deepEqual(Object.keys(visible), ['11', '12', '13', '21', '22', '31']);
});

test('active participant retains its real device and hides every own outgoing mirror', () => {
  const playerVisible = filterLiveDevices(devices, {}, gameStateIds, playerUser);
  const supporterVisible = filterLiveDevices(devices, {}, gameStateIds, supporterUser);

  assert.deepEqual(Object.keys(playerVisible), ['11', '21', '22', '31']);
  assert.deepEqual(Object.keys(supporterVisible), ['11', '12', '13', '21', '31']);
});

test('administrator bypasses participant filters but never sees the internal state device', () => {
  const positions = { 900: statePosition('player:1,supporter:2') };
  const visible = filterLiveDevices(devices, positions, gameStateIds, administrator);

  assert.deepEqual(Object.keys(visible), ['11', '12', '13', '21', '22', '31']);
});

test('malformed user metadata fails open for own-mirror suppression', () => {
  const malformedUser = {
    attributes: {
      traccarToolParticipantRole: 'player',
      traccarToolParticipantNumber: 0,
    },
  };
  const visible = filterLiveDevices(devices, {}, gameStateIds, malformedUser);

  assert.deepEqual(Object.keys(visible), ['11', '12', '13', '21', '22', '31']);
});

test('live positions and selection follow the visible device collection', () => {
  const positions = {
    11: { deviceId: 11 },
    12: { deviceId: 12 },
    21: { deviceId: 21 },
    31: { deviceId: 31 },
    900: statePosition('player:1'),
  };
  const visible = filterLiveDevices(devices, positions, gameStateIds, playerUser);

  assert.deepEqual(
    filterLivePositions(positions, visible).map((position) => position.deviceId),
    [21, 31],
  );
  assert.equal(shouldClearSelectedDevice(11, visible), true);
  assert.equal(shouldClearSelectedDevice(21, visible), false);
  assert.equal(shouldClearSelectedDevice(null, visible), false);
});

test('device ingestion separates state devices and preserves ordinary accessible devices', () => {
  let state = devicesReducer(undefined, devicesActions.refresh(Object.values(devices)));

  assert.equal(state.loaded, true);
  assert.deepEqual(Object.keys(state.items), ['11', '12', '13', '21', '22', '31']);
  assert.deepEqual(state.gameStateIds, { 900: true });

  state = devicesReducer(state, devicesActions.remove(900));
  assert.deepEqual(state.gameStateIds, {});
  state = devicesReducer(state, devicesActions.update([devices[900]]));
  assert.deepEqual(state.gameStateIds, { 900: true });

  state = devicesReducer(
    state,
    devicesActions.update([{ id: 11, attributes: { traccarToolGameState: true } }]),
  );
  assert.equal(state.items[11], undefined);
  assert.equal(state.gameStateIds[11], true);

  state = devicesReducer(state, devicesActions.update([devices[11], { id: 900, attributes: {} }]));
  assert.equal(state.items[11].id, 11);
  assert.equal(state.gameStateIds[11], undefined);
  assert.equal(state.items[900].id, 900);
  assert.equal(state.gameStateIds[900], undefined);

  state = devicesReducer(state, devicesActions.remove(900));
  assert.equal(state.items[900], undefined);
  assert.equal(state.gameStateIds[900], undefined);
});

test('refresh replaces stale state IDs and live filtering does not mutate its input', () => {
  let state = devicesReducer(undefined, devicesActions.refresh(Object.values(devices)));
  state = devicesReducer(state, devicesActions.refresh([devices[21]]));
  assert.deepEqual(Object.keys(state.items), ['21']);
  assert.deepEqual(state.gameStateIds, {});

  const accessibleDevices = { ...devices };
  filterLiveDevices(accessibleDevices, {}, gameStateIds, playerUser);
  assert.deepEqual(Object.keys(accessibleDevices), ['11', '12', '13', '21', '22', '31', '900']);
});
