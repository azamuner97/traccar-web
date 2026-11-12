import assert from 'node:assert/strict';
import test from 'node:test';
import { liveShareReason } from './gameText.js';
import {
  activeHunterLiveShares,
  breakView,
  canCancelRequest,
  connectionState,
  fakePingNumbers,
  breakRequest,
  fakeRequest,
  fakeUse,
  fakeUseAvailability,
  fillText,
  formatCountdown,
  gameAccountKey,
  gameMemberKey,
  gameMembership,
  holdsJokers,
  inventoryByType,
  isGameInvalidation,
  jokerAvailability,
  listenGameSync,
  localDateTimeInput,
  ownFakeRunTokens,
  participantOverviewView,
  participantsView,
  plannedBreaksView,
  remainingMs,
  requestGameSync,
  requestState,
  readsJokers,
  reservationsView,
  runningFakeChoice,
  selectGameMembership,
  selectedRunningFakeChoice,
  serverOffsetMs,
  sortedRequests,
  speedhuntActions,
  speedhuntPoolView,
  timetableSlotsView,
  timetableView,
  validGameJokers,
  validGameStatus,
} from './gameView.js';

const user = (extra = {}) => ({ id: 7, attributes: {}, ...extra });
// The computed status of /api/game-status; it names the account's membership.
const gameStatus = (role, changes = {}) => ({
  gameSessionId: 3,
  memberId: 40,
  role,
  number: 1,
  displayName: 'Member',
  controllerActive: true,
  serverTime: '2026-11-09T12:00:00Z',
  hash: '0123456789abcdef0123456789abcdef',
  status: {},
  ...changes,
});

test('hunter live shares follow the current account, member, controller and server-clock deadline', () => {
  const hunter = user();
  const always = { memberId: 11, name: 'Player 1' };
  const timed = { memberId: 12, name: 'Player 2', endsAt: '2026-11-10T10:00:00Z' };
  const now = Date.parse(timed.endsAt) - 5000;
  const game = {
    key: gameAccountKey(hunter),
    offsetMs: 3000,
    status: gameStatus('hunter', {
      status: {
        liveShares: [always, timed, { ...timed, endsAt: 'invalid' }, { ...always, memberId: 0 }],
      },
    }),
  };

  assert.deepEqual(activeHunterLiveShares(game, hunter, now), [always, timed]);
  assert.deepEqual(activeHunterLiveShares(game, hunter, now + 2000), [always]);
  assert.deepEqual(
    activeHunterLiveShares({ ...game, status: { ...game.status, role: 'spectator' } }, hunter, now),
    [],
  );
  assert.deepEqual(activeHunterLiveShares(game, user({ id: 8 }), now), []);
  assert.deepEqual(
    activeHunterLiveShares({ ...game, error: 'timetable unavailable' }, hunter, now),
    [always, timed],
  );
  assert.deepEqual(activeHunterLiveShares({ ...game, statusError: 'offline' }, hunter, now), []);
  const inactive = { ...game, status: { ...game.status, controllerActive: false } };
  assert.deepEqual(activeHunterLiveShares(inactive, hunter, now), []);
  assert.deepEqual(activeHunterLiveShares({ ...game, status: null }, hunter, now), []);
});
const at = (iso) => Date.parse(iso);

test('the catch roster sorts each group by name and reads only explicit player and supporter status', () => {
  const anna = { memberId: 11, number: 1, name: 'Anna', role: 'player', caught: true };
  const ben = { memberId: 12, number: 1, name: 'Ben', role: 'supporter', caught: false };
  const cleo = { memberId: 13, number: 2, name: 'Cleo', role: 'player', caught: false };
  const dana = { memberId: 14, number: 2, name: 'Dana', role: 'supporter', caught: true };
  const status = {
    participantOverview: [
      cleo,
      dana,
      { memberId: 15, name: 'Hunter', role: 'hunter', caught: false },
      { memberId: 16, name: 'Unknown', role: 'player' },
      anna,
      ben,
      { deviceId: 17, name: 'Device only', role: 'player', caught: false },
    ],
  };

  assert.deepEqual(participantOverviewView(status), [ben, cleo, anna, dana]);
  const returned = { ...anna, caught: false };
  status.participantOverview[4] = returned;
  assert.deepEqual(participantOverviewView(status), [returned, ben, cleo, dana]);
  assert.deepEqual(participantOverviewView({ participants: [ben] }), []);
  assert.deepEqual(participantOverviewView({ participantOverview: [] }), []);
});

test('live shares always show a reason and retain the geofence cause', () => {
  const t = (key) => key;
  assert.equal(liveShareReason(t, { source: 'geofence' }), 'gameLiveShareGeofence');
  assert.equal(
    liveShareReason(t, { source: 'geofence', reason: 'Public transport' }),
    'gameLiveShareGeofence · Public transport',
  );
  assert.equal(
    liveShareReason(t, { source: 'manual', reason: '  Public transport  ' }),
    'Public transport',
  );
  assert.equal(liveShareReason(t, { source: 'manual', reason: ' ' }), 'gameLiveShareManual');
  assert.equal(liveShareReason(t, { source: 'speedhunt' }), 'gameLiveShareSpeedhunt');
  assert.equal(liveShareReason(t, {}), 'gameLiveShareNoReason');
});

test('membership comes only from the computed status; players and supporters hold jokers', () => {
  const game = { key: '7', status: gameStatus('player', { number: 2 }) };
  assert.deepEqual(gameMembership(user(), game), {
    userId: 7,
    gameSessionId: 3,
    memberId: 40,
    role: 'player',
    number: 2,
  });
  assert.deepEqual(
    selectGameMembership({ session: { user: user() }, game }),
    gameMembership(user(), game),
  );
  assert.equal(gameMembership(user({ administrator: true }), game), null, 'administrators');
  assert.equal(gameMembership(user({ id: 8 }), game), null, 'another account');
  assert.equal(gameMembership(user(), { key: '7', status: null }), null, 'no membership');
  assert.equal(gameMembership(null, game), null);
  for (const changes of [{ role: 'operator' }, { memberId: 0 }, { gameSessionId: null }]) {
    assert.equal(gameMembership(user(), { key: '7', status: gameStatus('player', changes) }), null);
  }
  const legacy = user({
    attributes: {
      traccarToolUserRole: 'player',
      traccarToolSessionDeviceId: 900,
      traccarToolAssignedDeviceId: 11,
    },
  });
  assert.equal(gameMembership(legacy, { key: '7', status: null }), null, 'attributes are ignored');
  assert.deepEqual(['player', 'supporter', 'hunter', 'spectator'].map(holdsJokers), [
    true,
    true,
    false,
    false,
  ]);
});

test('the account key names every signed-in account except administrators', () => {
  assert.equal(gameAccountKey(user()), '7');
  assert.notEqual(gameAccountKey(user()), gameAccountKey(user({ id: 8 })));
  assert.equal(gameAccountKey(user({ administrator: true })), null);
  assert.equal(gameAccountKey(null), null);
  assert.equal(gameAccountKey(user({ id: 0 })), null);
});

test('the member key identifies session, member and role', () => {
  const key = gameMemberKey(gameStatus('player'));
  assert.equal(key, gameMemberKey({ gameSessionId: 3, memberId: 40, role: 'player' }));
  assert.notEqual(key, gameMemberKey(gameStatus('supporter')));
  assert.notEqual(key, gameMemberKey(gameStatus('player', { memberId: 41 })));
  assert.notEqual(key, gameMemberKey(gameStatus('player', { gameSessionId: 4 })));
  assert.equal(gameMemberKey(null), null);
  assert.equal(gameMemberKey(gameStatus('operator')), null);
});

test('game invalidations and reconnects ask for a sync', () => {
  assert.ok(isGameInvalidation(['devices', 'game-jokers']));
  assert.ok(isGameInvalidation(['game-status']));
  assert.ok(isGameInvalidation(['game-timetable']));
  assert.ok(isGameInvalidation(['game-speedhunt-history']));
  assert.ok(!isGameInvalidation(['game-notifications', 'game-proximity']));
  assert.ok(!isGameInvalidation(undefined));
  const calls = [];
  const unsubscribe = listenGameSync((resources) => calls.push(resources));
  requestGameSync(['game-status']);
  requestGameSync();
  unsubscribe();
  requestGameSync();
  assert.deepEqual(calls, [['game-status'], undefined]);
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

test('reservations: cancel held plans and armed fakes through delivery', () => {
  const view = reservationsView(
    {
      reservations: [
        {
          id: 1,
          type: 'fakePing',
          requestId: 40,
          status: 'reserved',
          armed: false,
          use: 'speedhunt',
          fake: { latitude: 47, longitude: 8, pingNumber: 3, bound: false },
        },
        {
          id: 2,
          type: 'fakePing',
          use: 'timetable',
          status: 'reserved',
          armed: true,
          fake: {
            entryId: 40,
            scheduledAt: '2026-11-09T12:00:50Z',
            latitude: 47.1,
            longitude: 8.5,
            bound: false,
          },
        },
        {
          id: 3,
          type: 'fakePing',
          status: 'reserved',
          armed: true,
          fake: {
            entryId: 41,
            scheduledAt: '2026-11-09T12:30:00Z',
            latitude: 47.2,
            longitude: 8.6,
            bound: false,
          },
        },
        {
          id: 4,
          type: 'fakePing',
          use: 'runningSpeedhunt',
          status: 'reserved',
          armed: true,
          fake: { latitude: 47, longitude: 8, pingNumber: 2, bound: false },
        },
        {
          id: 5,
          type: 'fakePing',
          use: 'speedhunt',
          status: 'consumed',
          armed: false,
          fake: { latitude: 47, longitude: 8, pingNumber: 1, bound: true },
        },
        { id: 'x', type: 'fakePing' },
        { id: 6, type: 'fakeTimetable', armed: true, fake: { entryId: 42 } },
      ],
    },
    new Set([40]),
    ownFakeRunTokens({
      fakes: [
        { reservationId: 4, use: 'runningSpeedhunt', runToken: 'a'.repeat(32) },
        { reservationId: 2, use: 'timetable' },
        { reservationId: 7, runToken: 'bad' },
      ],
    }),
  );
  assert.deepEqual(
    view.map((item) => [item.id, item.kind, item.cancellable]),
    [
      [2, 'armed', true],
      [3, 'armed', true],
      [4, 'armed', true],
      [1, 'held', true],
      [5, 'bound', false],
    ],
  );
  assert.equal(view[0].latitude, 47.1);
  assert.equal(view[0].reservationId, 2);
  assert.equal(view[2].runToken, 'a'.repeat(32), 'the run token comes from the status');
  assert.equal(view[0].runToken, null);
  assert.equal(view[4].pingNumber, 1);
  assert.deepEqual(
    view.map((item) => item.use),
    ['timetable', 'timetable', 'runningSpeedhunt', 'speedhunt', 'speedhunt'],
    'the use comes from the server or from the plan',
  );
});

test('requests: newest first, approval state and own cancellation', () => {
  const requests = sortedRequests([
    { id: 3, status: 'pending', approvalRequired: true, requesterMemberId: 40 },
    { id: 5, status: 'succeeded', requesterMemberId: 40 },
    { id: 'bad' },
  ]);
  assert.deepEqual(
    requests.map((item) => item.id),
    [5, 3],
  );
  assert.equal(requestState(requests[1]), 'awaitingApproval');
  assert.equal(requestState({ status: 'pending' }), 'pending');
  assert.ok(canCancelRequest(requests[1], 40));
  assert.ok(!canCancelRequest(requests[1], 41));
  assert.ok(!canCancelRequest(requests[1], null));
  assert.ok(!canCancelRequest(requests[0], 40));
});

test('joker availability never depends on whom a speedhunt targets', () => {
  const inventory = inventoryByType({
    inventories: [
      { type: 'hunterPositions', available: 1 },
      { type: 'break', available: 1 },
    ],
  });
  const base = { inventory, requests: [], status: {}, controllerActive: true, offsetMs: 0, now: 0 };
  assert.deepEqual(jokerAvailability('break', base), {
    enabled: true,
    reason: null,
    now: { enabled: true, reason: null },
  });
  assert.equal(jokerAvailability('break', { ...base, controllerActive: false }).reason, 'paused');
  assert.equal(
    jokerAvailability('break', {
      ...base,
      requests: [{ type: 'jokerBreak', status: 'pending' }],
    }).reason,
    'open',
  );
  // During a speedhunt a break can still be planned; only one that starts now waits.
  const duringSpeedhunt = jokerAvailability('break', {
    ...base,
    status: { speedhunt: { active: true } },
  });
  assert.ok(duringSpeedhunt.enabled);
  assert.equal(duringSpeedhunt.now.reason, 'speedhunt');
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
    }).now.reason,
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

test('planned breaks: from the status and open requests, cancellable while held or armed', () => {
  const now = at('2026-11-09T12:00:00Z');
  const status = {
    plannedBreaks: [
      {
        breakId: 1,
        reservationId: 21,
        startsAt: '2026-11-09T13:00:00Z',
        state: 'planned',
        plannedBy: 'participant',
      },
      {
        breakId: 3,
        reservationId: 23,
        startsAt: '2026-11-09T11:55:00Z',
        state: 'waiting',
        plannedBy: 'participant',
      },
      {
        breakId: 4,
        reservationId: null,
        startsAt: '2026-11-09T14:00:00Z',
        state: 'planned',
        plannedBy: 'operator',
      },
      { breakId: 5, startsAt: '2026-11-09T15:00:00Z', state: 'active' },
      { breakId: 6, startsAt: 'bad', state: 'planned' },
    ],
  };
  const requests = [
    {
      id: 9,
      type: 'jokerBreak',
      status: 'pending',
      parameters: { startsAt: '2026-11-09T12:30:00Z' },
    },
    { id: 10, type: 'jokerBreak', status: 'pending', parameters: {} },
    {
      id: 11,
      type: 'jokerBreak',
      status: 'succeeded',
      parameters: { startsAt: '2026-11-09T12:40:00Z' },
    },
    {
      id: 12,
      type: 'jokerFakePing',
      status: 'pending',
      parameters: { startsAt: '2026-11-09T12:45:00Z' },
    },
  ];
  const view = plannedBreaksView(status, requests, 0, now, new Set([9]));
  assert.deepEqual(
    view.map((item) => [item.id, item.kind, item.due, item.cancellable]),
    [
      ['break:3', 'armed', true, true],
      ['request:9', 'held', false, true],
      ['break:1', 'armed', false, true],
      ['break:4', 'armed', false, false],
    ],
  );
  assert.equal(view[2].reservationId, 21);
  assert.equal(view[1].requestId, 9);
  assert.equal(view[2].remainingMs, 3600000);
  assert.equal(
    plannedBreaksView(
      { plannedBreaks: [{ ...status.plannedBreaks[0], state: 'waiting' }] },
      [],
      0,
      now,
    )[0].due,
    true,
    'a waiting break starts as soon as possible',
  );
  assert.deepEqual(plannedBreaksView({}, [], 0, now), []);
  assert.deepEqual(breakRequest({ when: 'now' }), { type: 'jokerBreak' });
  const later = breakRequest({ when: 'later', time: localDateTimeInput(now + 3600000) });
  assert.equal(later.type, 'jokerBreak');
  assert.equal(Date.parse(later.parameters.startsAt), now + 3600000);
  assert.equal(breakRequest({ when: 'later', time: '' }), null);
  assert.equal(breakRequest({ when: 'later', time: 'soon' }), null);
  assert.match(localDateTimeInput(now), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test('answers are validated and texts filled', () => {
  const valid = gameStatus('player', {
    controllerActive: false,
    status: { speedhunt: { active: false } },
  });
  assert.ok(validGameStatus(valid));
  for (const changes of [
    { serverTime: undefined },
    { gameSessionId: 0 },
    { memberId: null },
    { role: 'operator' },
    { hash: 'not-a-hash' },
    { status: null },
    { controllerActive: 'yes' },
  ]) {
    assert.ok(!validGameStatus({ ...valid, ...changes }));
  }
  assert.ok(validGameJokers({ inventories: [], reservations: [], timetableEntries: [] }));
  assert.ok(!validGameJokers({ inventories: [] }));
  assert.equal(fillText('{a} and {a} of {b}', { a: 1, b: 'x' }), '1 and 1 of x');
  assert.equal(fillText(undefined), '');
});

const hunterStatus = {
  participants: [
    {
      memberId: 11,
      number: 1,
      name: 'Anna',
      role: 'player',
      caught: false,
      speedhunt: { running: true, pings: 2, live: false, revision: 4 },
      break: { active: false },
    },
    {
      memberId: 12,
      number: 1,
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
      memberId: 13,
      number: 2,
      name: 'Cleo',
      role: 'player',
      caught: false,
      speedhunt: { revision: 1 },
      break: { active: true, startedAt: '2026-11-09T11:58:00Z', endsAt: '2026-11-09T12:20:00Z' },
    },
    {
      memberId: 14,
      number: 3,
      name: 'Dan',
      role: 'player',
      caught: true,
      speedhunt: { revision: 1 },
    },
    { deviceId: 15, name: 'Device only', role: 'player', caught: false },
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

test('hunter speedhunt controls offer static and timed live pings', () => {
  const [anna, ben, cleo, dan] = participantsView(hunterStatus, 0, at('2026-11-09T12:00:00Z'));
  const base = { requests: [], controllerActive: true, limits: { fixedLiveMinutes: 5 } };
  assert.deepEqual(speedhuntActions(anna, base), {
    speedhuntStaticPing: true,
    speedhuntLivePing: true,
    reason: null,
    repeat: false,
  });
  assert.equal(speedhuntActions(anna, { ...base, limits: {} }).speedhuntLivePing, false);
  assert.equal(speedhuntActions(ben, base).speedhuntStaticPing, false, 'already live');
  assert.equal(speedhuntActions(ben, base).speedhuntLivePing, false, 'already live');
  assert.equal(speedhuntActions(cleo, base).reason, 'onBreak');
  assert.equal(speedhuntActions(dan, base).reason, 'caught');
  const open = speedhuntActions(anna, {
    ...base,
    requests: [{ type: 'speedhuntStaticPing', targetMemberId: 11, status: 'approved' }],
  });
  assert.equal(open.speedhuntStaticPing, false);
  assert.equal(open.speedhuntLivePing, false);
  assert.equal(open.reason, 'open');
  assert.equal(speedhuntActions(anna, { ...base, controllerActive: false }).reason, 'paused');
});

test('a ping that starts a speedhunt needs a joker of the hunters pool', () => {
  const [anna] = participantsView(hunterStatus, 0, at('2026-11-09T12:00:00Z'));
  const starting = { ...anna, speedhunt: { ...anna.speedhunt, startsRun: true } };
  const running = { ...anna, speedhunt: { ...anna.speedhunt, startsRun: false, running: true } };
  const base = { requests: [], controllerActive: true, limits: { fixedLiveMinutes: 5 } };
  const empty = speedhuntPoolView({
    inventories: [
      { memberId: null, type: 'speedhunt', granted: 2, used: 2, reserved: 0, available: 0 },
    ],
    reservations: [],
  });
  assert.deepEqual(empty, { granted: 2, used: 2, reserved: 0, available: 0, overAllocated: 0 });
  const refused = speedhuntActions(starting, { ...base, pool: empty });
  assert.equal(refused.speedhuntStaticPing, false);
  assert.equal(refused.speedhuntLivePing, false);
  assert.equal(refused.reason, 'noSpeedhuntJoker');
  assert.ok(
    speedhuntActions(running, { ...base, pool: empty }).speedhuntStaticPing,
    'a run uses none',
  );
  assert.ok(
    speedhuntActions(starting, { ...base, pool: { ...empty, available: 1 } }).speedhuntStaticPing,
  );
  assert.ok(
    speedhuntActions(starting, base).speedhuntStaticPing,
    'unknown pool: the server decides',
  );
  assert.equal(speedhuntPoolView({ inventories: [], reservations: [] }), null);
  assert.ok(readsJokers('hunter') && readsJokers('player') && !readsJokers('spectator'));
});

test('repeat targets use separate static and live approvals and honor hard blocking', () => {
  const [anna] = participantsView(hunterStatus, 0, at('2026-11-09T12:00:00Z'));
  const participant = { ...anna, speedhunt: { ...anna.speedhunt, startsRun: true } };
  const limits = {
    fixedLiveMinutes: 5,
    allowConsecutiveSpeedhunts: false,
    limitEnforcement: 'warn',
    requestApprovals: { speedhuntStaticPing: true, speedhuntLivePing: false },
  };
  const base = { requests: [], controllerActive: true, lastSpeedhuntMemberId: 11, limits };
  assert.deepEqual(speedhuntActions(participant, base), {
    speedhuntStaticPing: true,
    speedhuntLivePing: false,
    reason: null,
    repeat: true,
  });
  const blocked = speedhuntActions(participant, {
    ...base,
    limits: { ...limits, limitEnforcement: 'block' },
  });
  assert.equal(blocked.speedhuntStaticPing, false);
  assert.equal(blocked.speedhuntLivePing, false);
  assert.equal(blocked.repeat, true);
  assert.equal(speedhuntActions(anna, base).speedhuntLivePing, true, 'continuation');
  assert.equal(speedhuntActions(participant, { ...base, lastSpeedhuntMemberId: 12 }).repeat, false);
});

test('hunter timetable slots collapse simultaneous pings and advance the countdown at the scheduled time', () => {
  const now = at('2026-11-09T12:00:00Z');
  const slots = [
    { scheduledAt: '2026-11-09T12:05:00Z' },
    { scheduledAt: '2026-11-09T12:00:01Z' },
    { scheduledAt: '2026-11-09T13:00:01+01:00', memberId: 11, state: 'sent' },
    { scheduledAt: 'bad' },
  ];
  assert.deepEqual(timetableSlotsView(slots, 500, now), [
    { scheduledAt: '2026-11-09T12:00:01.000Z', upcoming: true, remainingMs: 500 },
    { scheduledAt: '2026-11-09T12:05:00.000Z', upcoming: true, remainingMs: 299500 },
  ]);
  assert.deepEqual(timetableSlotsView(slots, 500, now + 500), [
    { scheduledAt: '2026-11-09T12:00:01.000Z', upcoming: false, remainingMs: 0 },
    { scheduledAt: '2026-11-09T12:05:00.000Z', upcoming: true, remainingMs: 299000 },
  ]);
});

test('timetable pings show scheduled, due, disconnected, sent, skipped, failed, break and out', () => {
  const now = at('2026-11-09T12:00:00Z');
  const participants = participantsView(hunterStatus, 0, now);
  const ping = (entryId, memberId, time, state) => ({
    entryId,
    memberId,
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
    memberId: 11,
    caught: false,
    break: breakView(
      { active: true, startedAt: '2026-11-09T11:55:00Z', endsAt: '2026-11-09T12:10:00Z' },
      0,
      now,
    ),
  };
  const ping = (entryId, time) => ({
    entryId,
    memberId: 11,
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
    runningSpeedhunt: { enabled: false, reason: 'noRunningHunt' },
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
    runningSpeedhunt: { enabled: false, reason: 'noRunningHunt' },
  });
  assert.equal(fakeUse({ entryId: 40 }), 'timetable');
  assert.equal(fakeUse({ pingNumber: 2 }), 'speedhunt');
  assert.equal(fakeUse({}), null);
  const [own] = reservationsView({
    reservations: [{ id: 3, type: 'fakePing', armed: true, fake: { entryId: 40 } }],
  });
  assert.equal(own.entryId, 40);
  assert.equal(own.use, 'timetable');
});

test('a running fake selects an anonymous remaining slot and holds only its own run', () => {
  const running = { runToken: 'a'.repeat(32), firstPing: 2, lastPing: 4 };
  const selection = { kind: 'runningSpeedhunt', running, latitude: 47, longitude: 8 };
  assert.deepEqual(runningFakeChoice({ runningFake: running }), running);
  assert.equal(runningFakeChoice({ runningFake: { ...running, firstPing: 5 } }), null);
  assert.equal(fakeRequest({ ...selection, pingNumber: 1 }), null);
  assert.deepEqual(fakeRequest({ ...selection, pingNumber: 3 }), {
    type: 'jokerFakePing',
    parameters: { runToken: running.runToken, pingNumber: 3, latitude: 47, longitude: 8 },
  });
  const reservations = [
    {
      type: 'fakePing',
      use: 'runningSpeedhunt',
      kind: 'armed',
      runToken: running.runToken,
    },
  ];
  assert.equal(
    fakeUseAvailability({ running, reservations }).runningSpeedhunt.reason,
    'runningFakePlanned',
  );
  const nextRun = { ...running, runToken: 'b'.repeat(32) };
  assert.ok(fakeUseAvailability({ running: nextRun, reservations }).runningSpeedhunt.enabled);
  assert.ok(fakeUseAvailability({ running, reservations }).speedhunt.enabled);
});

test('an open fake picker uses fresh slots and stays pinned to the original hunt', () => {
  const runningFake = { runToken: 'a'.repeat(32), firstPing: 3, lastPing: 4 };
  const selected = selectedRunningFakeChoice(runningFake.runToken, { runningFake });
  assert.equal(selected.firstPing, 3);
  assert.equal(
    fakeRequest({
      kind: 'runningSpeedhunt',
      running: selected,
      pingNumber: 2,
      latitude: 47,
      longitude: 8,
    }),
    null,
  );
  assert.equal(selectedRunningFakeChoice(runningFake.runToken, {}), null);
  assert.equal(
    selectedRunningFakeChoice(runningFake.runToken, {
      runningFake: { ...runningFake, runToken: 'b'.repeat(32) },
    }),
    null,
  );
});
