import assert from 'node:assert/strict';
import test from 'node:test';
import {
  breakView,
  canCancelRequest,
  connectionState,
  fakePingNumbers,
  fakeRequest,
  fakeUse,
  fakeUseAvailability,
  fillText,
  formatCountdown,
  gameAccountKey,
  gameRole,
  holdsJokers,
  inventoryByType,
  isGameInvalidation,
  jokerAvailability,
  listenGameSync,
  participantsView,
  remainingMs,
  requestGameSync,
  requestState,
  reservationsView,
  serverOffsetMs,
  sortedRequests,
  speedhuntActions,
  timetableView,
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
  assert.ok(isGameInvalidation(['game-timetable']));
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
  assert.equal(inventory.fakePing.granted, 0);
  assert.equal(inventory.fakeTimetable, undefined, 'one fake-ping joker');
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
          type: 'fakePing',
          use: 'timetable',
          armed: true,
          bound: false,
          plan: {
            entryId: 40,
            scheduledAt: '2026-11-09T12:00:50Z',
            latitude: 47.1,
            longitude: 8.5,
          },
        },
        {
          id: 3,
          type: 'fakePing',
          armed: true,
          bound: false,
          plan: {
            entryId: 41,
            scheduledAt: '2026-11-09T12:30:00Z',
            latitude: 47.2,
            longitude: 8.6,
          },
        },
        { id: 4, type: 'fakePing', armed: true, bound: false, plan: { pingNumber: 2 } },
        {
          id: 5,
          type: 'fakePing',
          use: 'speedhunt',
          armed: false,
          bound: true,
          status: 'consumed',
          plan: { pingNumber: 1, boundAt: '2026-11-09T11:50:00Z' },
        },
        { id: 'x', type: 'fakePing' },
        { id: 6, type: 'fakeTimetable', armed: true, plan: { entryId: 42 } },
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
  assert.deepEqual(
    view.map((item) => item.use),
    ['timetable', 'timetable', 'speedhunt', null, 'speedhunt'],
    'the use comes from the server or from the plan',
  );
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

const hunterStatus = {
  participants: [
    {
      deviceId: 11,
      name: 'Anna',
      role: 'player',
      caught: false,
      speedhunt: { operation: true, running: true, pings: 2, live: false, revision: 4 },
      break: { active: false },
    },
    {
      deviceId: 12,
      name: 'Ben',
      role: 'supporter',
      caught: false,
      speedhunt: {
        running: false,
        pings: 0,
        live: true,
        liveUntil: '2026-11-09T12:30:00Z',
        revision: 2,
      },
      break: { active: false },
    },
    {
      deviceId: 13,
      name: 'Cleo',
      role: 'player',
      caught: false,
      speedhunt: { revision: 1 },
      break: { active: true, startedAt: '2026-11-09T11:58:00Z', endsAt: '2026-11-09T12:20:00Z' },
    },
    { deviceId: 14, name: 'Dan', role: 'player', caught: true, speedhunt: { revision: 1 } },
  ],
};

test('hunters see every participant with the named speedhunt state and breaks', () => {
  const now = at('2026-11-09T12:00:00Z');
  const participants = participantsView(hunterStatus, 0, now);
  assert.deepEqual(
    participants.map((item) => [item.name, item.caught, item.break.state]),
    [
      ['Anna', false, 'none'],
      ['Ben', false, 'none'],
      ['Cleo', false, 'active'],
      ['Dan', true, 'none'],
    ],
  );
  assert.equal(participants[1].speedhunt.liveUntil, '2026-11-09T12:30:00Z');
  assert.deepEqual(
    participantsView({ speedhunt: { active: true } }, 0, now),
    [],
    'players get none',
  );
});

test('shared speedhunt controls mirror the Tool checks', () => {
  const [anna, ben, cleo, dan] = participantsView(hunterStatus, 0, at('2026-11-09T12:00:00Z'));
  const base = { requests: [], controllerActive: true };
  const pick = (actions) =>
    ['speedhuntStaticPing', 'speedhuntLivePing', 'speedhuntStopLivePing', 'speedhuntTerminate']
      .filter((type) => actions[type])
      .join(',');
  assert.equal(
    pick(speedhuntActions(anna, base)),
    'speedhuntStaticPing,speedhuntLivePing,speedhuntTerminate',
  );
  assert.equal(pick(speedhuntActions(ben, base)), 'speedhuntStopLivePing');
  assert.equal(pick(speedhuntActions(cleo, base)), '');
  assert.equal(speedhuntActions(cleo, base).reason, 'onBreak');
  assert.equal(speedhuntActions(dan, base).reason, 'caught');
  const open = speedhuntActions(anna, {
    ...base,
    requests: [{ type: 'speedhuntStaticPing', targetDeviceId: 11, status: 'approved' }],
  });
  assert.equal(pick(open), '');
  assert.equal(open.reason, 'open');
  assert.equal(speedhuntActions(anna, { ...base, controllerActive: false }).reason, 'paused');
});

test('timetable pings show scheduled, due, disconnected, sent, skipped, failed, break and out', () => {
  const now = at('2026-11-09T12:00:00Z');
  const participants = participantsView(hunterStatus, 0, now);
  const ping = (entryId, deviceId, time, state) => ({
    entryId,
    deviceId,
    scheduledAt: `2026-11-09T${time}:00Z`,
    state,
    stateAt: null,
    fakeAllowed: null,
  });
  const pings = [
    ping(1, 11, '11:40', 'sent'),
    ping(2, 12, '11:50', 'skipped'),
    ping(3, 11, '11:55', 'failed'),
    ping(4, 12, '11:59', 'scheduled'),
    ping(5, 13, '12:10', 'scheduled'),
    ping(6, 13, '12:30', 'scheduled'),
    ping(7, 14, '12:10', 'scheduled'),
    ping(8, 11, '12:05', 'scheduled'),
    { entryId: 9, scheduledAt: 'bad', state: 'sent' },
    ping(10, 11, '12:06', 'mystery'),
    ping(11, 13, '11:57', 'scheduled'),
    ping(12, 13, '11:59', 'scheduled'),
  ];
  const running = timetableView(pings, { participants, offsetMs: 0, now, controllerActive: true });
  assert.deepEqual(
    running.map((item) => [item.entryId, item.state]),
    [
      [1, 'sent'],
      [2, 'skipped'],
      [3, 'failed'],
      [11, 'due'],
      [4, 'due'],
      [12, 'protected'],
      [8, 'scheduled'],
      [5, 'protected'],
      [7, 'out'],
      [6, 'scheduled'],
    ],
  );
  const anna = running.find((item) => item.entryId === 8);
  assert.equal(anna.name, 'Anna');
  assert.equal(anna.remainingMs, 300000);
  assert.ok(anna.upcoming && !running.find((item) => item.entryId === 4).upcoming);
  const paused = timetableView(pings, { participants, offsetMs: 0, now, controllerActive: false });
  assert.equal(paused.find((item) => item.entryId === 4).state, 'disconnected');
  const offline = timetableView(pings, {
    participants,
    offsetMs: 0,
    now,
    controllerActive: true,
    connected: false,
  });
  assert.equal(offline.find((item) => item.entryId === 4).state, 'disconnected');
});

test("a member's own break marks their own pings and allows no fake inside it", () => {
  const now = at('2026-11-09T12:00:00Z');
  const own = {
    deviceId: 11,
    caught: false,
    break: breakView(
      { active: true, startedAt: '2026-11-09T11:55:00Z', endsAt: '2026-11-09T12:10:00Z' },
      0,
      now,
    ),
  };
  const ping = (entryId, time) => ({
    entryId,
    deviceId: 11,
    scheduledAt: `2026-11-09T${time}:00Z`,
    state: 'scheduled',
    stateAt: null,
    fakeAllowed: true,
  });
  const view = timetableView([ping(1, '12:05'), ping(2, '12:20')], {
    participants: [own],
    offsetMs: 0,
    now,
    controllerActive: true,
  });
  assert.deepEqual(
    view.map((item) => [item.entryId, item.state, item.fakeAllowed]),
    [
      [1, 'protected', false],
      [2, 'scheduled', true],
    ],
  );
});

test('fakes: valid requests only, ping numbers within the limit, one unbound speedhunt fake', () => {
  assert.deepEqual(fakePingNumbers(4), [1, 2, 3, 4]);
  assert.equal(fakePingNumbers(null), null);
  assert.deepEqual(
    fakeRequest({ kind: 'timetable', entryId: 40, latitude: 47.1234567, longitude: 8.5 }),
    {
      type: 'jokerFakePing',
      parameters: { entryId: 40, latitude: 47.123457, longitude: 8.5 },
    },
  );
  assert.deepEqual(fakeRequest({ kind: 'speedhunt', pingNumber: 2, latitude: 1, longitude: 2 }), {
    type: 'jokerFakePing',
    parameters: { pingNumber: 2, latitude: 1, longitude: 2 },
  });
  assert.equal(fakeRequest({ kind: 'speedhunt', pingNumber: 0, latitude: 1, longitude: 2 }), null);
  assert.equal(fakeRequest({ kind: 'timetable', entryId: 40, latitude: 91, longitude: 2 }), null);
  assert.equal(fakeRequest({ kind: 'timetable', latitude: 1, longitude: 2 }), null);

  const inventory = inventoryByType({ inventories: [{ type: 'fakePing', available: 1 }] });
  const base = { inventory, requests: [], status: {}, controllerActive: true, offsetMs: 0, now: 0 };
  const ping = [{ fakeAllowed: true, upcoming: true }];
  const armedSpeedhunt = [{ type: 'fakePing', use: 'speedhunt', kind: 'armed' }];
  // One joker, two uses: a timetable ping needs one that can carry a fake; the next speedhunt holds one.
  const noPing = jokerAvailability('fakePing', base);
  assert.ok(noPing.enabled);
  assert.deepEqual(noPing.uses, {
    timetable: { enabled: false, reason: 'noPing' },
    speedhunt: { enabled: true, reason: null },
  });
  assert.ok(jokerAvailability('fakePing', { ...base, pings: ping }).uses.timetable.enabled);
  const planned = jokerAvailability('fakePing', {
    ...base,
    pings: ping,
    reservations: armedSpeedhunt,
  });
  assert.ok(planned.enabled);
  assert.equal(planned.uses.speedhunt.reason, 'planned');
  assert.equal(
    jokerAvailability('fakePing', { ...base, reservations: armedSpeedhunt }).reason,
    'noFakeUse',
  );
  assert.ok(
    jokerAvailability('fakePing', {
      ...base,
      reservations: [{ type: 'fakePing', use: 'speedhunt', kind: 'bound' }],
    }).uses.speedhunt.enabled,
    'a bound fake does not hold the next one',
  );
  assert.deepEqual(fakeUseAvailability(), {
    timetable: { enabled: false, reason: 'noPing' },
    speedhunt: { enabled: true, reason: null },
  });
  assert.equal(fakeUse({ entryId: 40 }), 'timetable');
  assert.equal(fakeUse({ pingNumber: 2 }), 'speedhunt');
  assert.equal(fakeUse({}), null);
  const [own] = reservationsView(
    { reservations: [{ id: 3, type: 'fakePing', armed: true, plan: { entryId: 40 } }] },
    0,
    0,
  );
  assert.equal(own.entryId, 40);
  assert.equal(own.use, 'timetable');
});
