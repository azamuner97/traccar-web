import assert from 'node:assert/strict';
import test from 'node:test';
import { gameActions, gameReducer } from './game.js';
import { gameMemberKey } from '../game/gameView.js';

// A computed status of /api/game-status (data model 2); it names the caller's membership.
const status = (changes = {}) => ({
  gameSessionId: 3,
  memberId: 40,
  role: 'player',
  number: 1,
  displayName: 'Anna',
  controllerActive: true,
  serverTime: '2026-11-11T12:00:00Z',
  hash: '0123456789abcdef0123456789abcdef',
  status: { participantOverview: [] },
  ...changes,
});
const memberKey = gameMemberKey(status());

test('answers for another account are ignored and a reset clears everything', () => {
  let state = gameReducer(undefined, gameActions.reset('5'));
  const statusPayload = { status: status(), offsetMs: 30, refreshedAt: 5 };
  const payload = {
    memberKey,
    requests: [{ id: 1 }],
    jokers: { inventories: [], reservations: [] },
  };
  state = gameReducer(state, gameActions.refreshStatus({ key: '6', ...statusPayload }));
  assert.equal(state.status, null, 'a late status for the previous account never shows');
  assert.equal(state.membership, 'unknown');
  state = gameReducer(state, gameActions.refresh({ key: '6', ...payload }));
  assert.equal(state.detailsLoaded, false, 'a late answer for the previous account never shows');
  state = gameReducer(state, gameActions.refresh({ key: '5', ...payload }));
  assert.equal(state.detailsLoaded, false, 'details wait for the status that names their member');
  state = gameReducer(state, gameActions.refreshStatus({ key: '5', ...statusPayload }));
  assert.equal(state.membership, 'member');
  assert.equal(state.loaded, false, 'the Game page waits for both status and details');
  state = gameReducer(state, gameActions.refresh({ key: '5', ...payload }));
  assert.equal(state.loaded, true);
  assert.equal(state.offsetMs, 30);
  state = gameReducer(state, gameActions.failed({ key: '6', message: 'x' }));
  assert.equal(state.error, null);
  state = gameReducer(state, gameActions.failed({ key: '5', message: 'offline' }));
  assert.equal(state.error, 'offline');
  assert.equal(state.loaded, true, 'the last answer stays shown after a failed refresh');
  state = gameReducer(state, gameActions.refresh({ key: '5', ...payload }));
  assert.equal(state.error, null);
  state = gameReducer(state, gameActions.reset('6'));
  assert.deepEqual(
    [state.key, state.membership, state.loaded, state.status, state.requests, state.jokers],
    ['6', 'unknown', false, null, [], null],
  );
});

test('status and details recover independently', () => {
  const key = '7';
  const hunter = status({ role: 'hunter', status: { participants: [] } });
  let state = gameReducer(undefined, gameActions.reset(key));
  state = gameReducer(
    state,
    gameActions.refreshStatus({ key, status: hunter, offsetMs: 10, refreshedAt: 5 }),
  );
  state = gameReducer(state, gameActions.failed({ key, message: 'timetable unavailable' }));
  assert.equal(state.status, hunter);
  assert.equal(state.error, 'timetable unavailable');
  assert.equal(state.statusError, null);
  assert.equal(state.loaded, false);

  state = gameReducer(state, gameActions.statusFailed({ key, message: 'status unavailable' }));
  state = gameReducer(
    state,
    gameActions.refresh({ key, memberKey: gameMemberKey(hunter), requests: [], jokers: null }),
  );
  assert.equal(state.error, null);
  assert.equal(state.statusError, 'status unavailable');
  assert.equal(state.loaded, true);
});

test('an unchanged hash keeps the stored status; a changed one replaces it', () => {
  let state = gameReducer(undefined, gameActions.reset('5'));
  const first = status();
  state = gameReducer(
    state,
    gameActions.refreshStatus({ key: '5', status: first, offsetMs: 1, refreshedAt: 1 }),
  );
  const same = status({ serverTime: '2026-11-11T12:00:30Z' });
  state = gameReducer(
    state,
    gameActions.refreshStatus({ key: '5', status: same, offsetMs: 2, refreshedAt: 2 }),
  );
  assert.equal(state.status, first, 'views derived from the status are not recomputed');
  assert.equal(state.offsetMs, 2, 'the clock offset still follows the latest answer');
  assert.equal(state.refreshedAt, 2);
  const changed = status({ hash: 'fedcba9876543210fedcba9876543210' });
  state = gameReducer(
    state,
    gameActions.refreshStatus({ key: '5', status: changed, offsetMs: 3, refreshedAt: 3 }),
  );
  assert.equal(state.status, changed);
});

test('another member clears the details, even with an equal hash', () => {
  let state = gameReducer(undefined, gameActions.reset('5'));
  state = gameReducer(
    state,
    gameActions.refreshStatus({ key: '5', status: status(), offsetMs: 0, refreshedAt: 1 }),
  );
  state = gameReducer(state, gameActions.refresh({ key: '5', memberKey, requests: [{ id: 1 }] }));
  assert.equal(state.loaded, true);
  // A role change makes a new member; two members who observe the same get the same hash.
  const other = status({ memberId: 41, role: 'supporter' });
  state = gameReducer(
    state,
    gameActions.refreshStatus({ key: '5', status: other, offsetMs: 0, refreshedAt: 2 }),
  );
  assert.equal(state.status, other);
  assert.deepEqual([state.loaded, state.detailsLoaded, state.requests], [false, false, []]);
  state = gameReducer(state, gameActions.refresh({ key: '5', memberKey, requests: [{ id: 2 }] }));
  assert.equal(state.detailsLoaded, false, 'late details of the previous member never show');
  state = gameReducer(state, gameActions.failed({ key: '5', memberKey, message: 'late' }));
  assert.equal(state.error, null, 'late failures of the previous member never show');
});

test('an account without membership has no status or details', () => {
  let state = gameReducer(undefined, gameActions.reset('5'));
  state = gameReducer(
    state,
    gameActions.refreshStatus({ key: '5', status: status(), offsetMs: 0, refreshedAt: 1 }),
  );
  state = gameReducer(state, gameActions.refresh({ key: '5', memberKey, requests: [{ id: 1 }] }));
  state = gameReducer(state, gameActions.noMembership({ key: '6' }));
  assert.equal(state.membership, 'member', 'another account is ignored');
  state = gameReducer(state, gameActions.noMembership({ key: '5' }));
  assert.deepEqual(
    [state.key, state.membership, state.status, state.requests, state.loaded],
    ['5', 'none', null, [], false],
  );
});
