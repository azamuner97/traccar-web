import assert from 'node:assert/strict';
import test from 'node:test';
import {
  breakView,
  canCancelRequest,
  connectionState,
  fillText,
  formatCountdown,
  gameAccountKey,
  gameRole,
  holdsJokers,
  inventoryByType,
  isGameInvalidation,
  jokerAvailability,
  listenGameSync,
  remainingMs,
  requestGameSync,
  requestState,
  reservationsView,
  serverOffsetMs,
  sortedRequests,
  validGameJokers,
  validGameStatus,
} from './gameView.js';

const user = (role, extra = {}) => ({
  id: 7,
  attributes: {
    traccarToolUserRole: role,
    traccarToolSessionDeviceId: 900,
    traccarToolAssignedDeviceId: 11,
  },
  ...extra,
});
const at = (iso) => Date.parse(iso);

test('only generated game accounts have a game role; players and supporters hold jokers', () => {
  assert.equal(gameRole(user('player')), 'player');
  assert.equal(gameRole(user('spectator')), 'spectator');
  assert.equal(gameRole(user('player', { administrator: true })), null);
  assert.equal(gameRole(user('operator')), null);
  assert.equal(gameRole(null), null);
  assert.deepEqual(['player', 'supporter', 'hunter', 'spectator'].map(holdsJokers), [
    true,
    true,
    false,
    false,
  ]);
});

test('the account key changes with the account, role and assignment', () => {
  const key = gameAccountKey(user('player'));
  assert.notEqual(key, gameAccountKey(user('supporter')));
  assert.notEqual(key, gameAccountKey({ ...user('player'), id: 8 }));
  assert.notEqual(
    key,
    gameAccountKey(
      user('player', {
        attributes: { ...user('player').attributes, traccarToolAssignedDeviceId: 12 },
      }),
    ),
  );
  assert.equal(gameAccountKey(user('player', { administrator: true })), null);
});

test('game invalidations and reconnects ask for a sync', () => {
  assert.ok(isGameInvalidation(['devices', 'game-jokers']));
  assert.ok(isGameInvalidation(['game-status']));
  assert.ok(!isGameInvalidation(['game-notifications', 'game-proximity']));
  assert.ok(!isGameInvalidation(undefined));
  let calls = 0;
  const unsubscribe = listenGameSync(() => {
    calls += 1;
  });
  requestGameSync();
  unsubscribe();
  requestGameSync();
  assert.equal(calls, 1);
});

test('countdowns use the server clock and absolute deadlines', () => {
  // The server is 30 s ahead of this device.
  const offset = serverOffsetMs('2026-11-09T12:00:30Z', at('2026-11-09T12:00:00Z'));
  assert.equal(offset, 30000);
  assert.equal(serverOffsetMs('nonsense', 0), 0);
  const deviceNow = at('2026-11-09T12:00:00Z');
  assert.equal(remainingMs('2026-11-09T12:10:30Z', offset, deviceNow), 600000);
  assert.equal(remainingMs('2026-11-09T11:00:00Z', offset, deviceNow), 0);
  assert.equal(remainingMs(null, offset, deviceNow), null);
  assert.equal(formatCountdown(600000), '10:00');
  assert.equal(formatCountdown(3725000), '1:02:05');
  assert.equal(formatCountdown(1), '0:01');
});

test('a break past its deadline shows as ending until the Tool ends it', () => {
  const published = {
    active: true,
    startedAt: '2026-11-09T12:00:00Z',
    endsAt: '2026-11-09T12:15:00Z',
  };
  const active = breakView(published, 0, at('2026-11-09T12:05:00Z'));
  assert.equal(active.state, 'active');
  assert.equal(active.remainingMs, 600000);
  assert.equal(breakView(published, 0, at('2026-11-09T12:15:00Z')).state, 'ending');
  // The server's clock decides: 5 minutes behind on this device is still past the deadline there.
  assert.equal(breakView(published, 300000, at('2026-11-09T12:12:00Z')).state, 'ending');
  assert.equal(breakView({ active: false }, 0).state, 'none');
  assert.equal(breakView(undefined, 0).state, 'none');
});

test('connection states distinguish disconnected, paused and running', () => {
  assert.equal(
    connectionState({ socket: false, loaded: true, controllerActive: true }),
    'disconnected',
  );
  assert.equal(connectionState({ socket: true, loaded: false }), 'loading');
  assert.equal(connectionState({ socket: true, loaded: false, error: 'x' }), 'error');
  assert.equal(connectionState({ socket: true, loaded: true, controllerActive: false }), 'paused');
  assert.equal(connectionState({ socket: null, loaded: true, controllerActive: true }), 'running');
});

test('inventories default to zero and ignore unknown types and bad numbers', () => {
  const inventory = inventoryByType({
    inventories: [
      { type: 'hunterPositions', granted: 2, used: 3, reserved: 0, available: 0, overAllocated: 1 },
      { type: 'break', granted: 1, used: 0, reserved: 1, available: -4, overAllocated: 0 },
      { type: 'unknown', granted: 9 },
    ],
  });
  assert.deepEqual(inventory.hunterPositions, {
    granted: 2,
    used: 3,
    reserved: 0,
    available: 0,
    overAllocated: 1,
  });
  assert.equal(inventory.break.available, 0);
  assert.equal(inventory.fakeTimetable.granted, 0);
  assert.equal(inventory.unknown, undefined);
});

test('reservations: held, armed with cancellation cut-off, and bound fakes', () => {
  const now = at('2026-11-09T12:00:00Z');
  const view = reservationsView(
    {
      reservations: [
        { id: 1, type: 'hunterPositions', requestId: 40, armed: false, bound: false, plan: {} },
        {
          id: 2,
          type: 'fakeTimetable',
          armed: true,
          bound: false,
          plan: { scheduledAt: '2026-11-09T12:00:50Z', latitude: 47.1, longitude: 8.5 },
        },
        {
          id: 3,
          type: 'fakeTimetable',
          armed: true,
          bound: false,
          plan: { scheduledAt: '2026-11-09T12:30:00Z', latitude: 47.2, longitude: 8.6 },
        },
        { id: 4, type: 'fakeSpeedhunt', armed: true, bound: false, plan: { pingNumber: 2 } },
        {
          id: 5,
          type: 'fakeSpeedhunt',
          armed: false,
          bound: true,
          status: 'consumed',
          plan: { pingNumber: 1, boundAt: '2026-11-09T11:50:00Z' },
        },
        { id: 'x', type: 'fakeSpeedhunt' },
      ],
    },
    0,
    now,
  );
  assert.deepEqual(
    view.map((item) => [item.id, item.kind, item.cancellable]),
    [
      [2, 'armed', false],
      [3, 'armed', true],
      [4, 'armed', true],
      [1, 'held', false],
      [5, 'bound', false],
    ],
  );
  assert.equal(view[0].latitude, 47.1);
  assert.equal(view[4].boundAt, '2026-11-09T11:50:00Z');
});

test('requests: newest first, approval state and own cancellation', () => {
  const requests = sortedRequests([
    { id: 3, status: 'pending', approvalRequired: true, requesterUserId: 7 },
    { id: 5, status: 'succeeded', requesterUserId: 7 },
    { id: 'bad' },
  ]);
  assert.deepEqual(
    requests.map((item) => item.id),
    [5, 3],
  );
  assert.equal(requestState(requests[1]), 'awaitingApproval');
  assert.equal(requestState({ status: 'pending' }), 'pending');
  assert.ok(canCancelRequest(requests[1], 7));
  assert.ok(!canCancelRequest(requests[1], 8));
  assert.ok(!canCancelRequest(requests[0], 7));
});

test('joker availability never depends on whom a speedhunt targets', () => {
  const inventory = inventoryByType({
    inventories: [
      { type: 'hunterPositions', available: 1 },
      { type: 'break', available: 1 },
    ],
  });
  const base = { inventory, requests: [], status: {}, controllerActive: true, offsetMs: 0, now: 0 };
  assert.deepEqual(jokerAvailability('break', base), { enabled: true, reason: null });
  assert.equal(jokerAvailability('break', { ...base, controllerActive: false }).reason, 'paused');
  assert.equal(
    jokerAvailability('break', {
      ...base,
      requests: [{ type: 'jokerBreak', status: 'pending' }],
    }).reason,
    'open',
  );
  assert.equal(
    jokerAvailability('break', { ...base, status: { speedhunt: { active: true } } }).reason,
    'speedhunt',
  );
  // Only the anonymous status counts: the same for every participant, target or not.
  assert.equal(
    jokerAvailability('hunterPositions', { ...base, status: { speedhunt: { active: true } } })
      .enabled,
    true,
  );
  assert.equal(
    jokerAvailability('break', {
      ...base,
      now: at('2026-11-09T12:05:00Z'),
      status: { break: { active: true, endsAt: '2026-11-09T12:15:00Z' } },
    }).reason,
    'onBreak',
  );
  assert.equal(
    jokerAvailability('hunterPositions', {
      ...base,
      inventory: inventoryByType({ inventories: [] }),
    }).reason,
    'none',
  );
});

test('answers are validated and texts filled', () => {
  assert.ok(
    validGameStatus({
      role: 'player',
      controllerActive: false,
      serverTime: '2026-11-09T12:00:00Z',
      status: { speedhunt: { active: false } },
    }),
  );
  assert.ok(!validGameStatus({ role: 'player', controllerActive: false, status: {} }));
  assert.ok(validGameJokers({ inventories: [], reservations: [], timetableEntries: [] }));
  assert.ok(!validGameJokers({ inventories: [] }));
  assert.equal(fillText('{a} and {a} of {b}', { a: 1, b: 'x' }), '1 and 1 of x');
  assert.equal(fillText(undefined), '');
});
