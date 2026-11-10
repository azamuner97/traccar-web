import assert from 'node:assert/strict';
import test from 'node:test';
import { gameActions, gameReducer } from './game.js';

test('answers for another account are ignored and a reset clears everything', () => {
  let state = gameReducer(undefined, gameActions.reset('anna'));
  const statusPayload = {
    status: { role: 'player' },
    offsetMs: 30,
    refreshedAt: 5,
  };
  const payload = { requests: [{ id: 1 }], jokers: { inventories: [], reservations: [] } };
  state = gameReducer(state, gameActions.refreshStatus({ key: 'ben', ...statusPayload }));
  assert.equal(state.status, null, 'a late status for the previous account never shows');
  state = gameReducer(state, gameActions.refresh({ key: 'ben', ...payload }));
  assert.equal(state.detailsLoaded, false, 'a late answer for the previous account never shows');
  state = gameReducer(state, gameActions.refresh({ key: 'anna', ...payload }));
  assert.equal(state.loaded, false, 'the Game page waits for both status and details');
  state = gameReducer(state, gameActions.refreshStatus({ key: 'anna', ...statusPayload }));
  assert.equal(state.loaded, true);
  assert.equal(state.offsetMs, 30);
  state = gameReducer(state, gameActions.failed({ key: 'ben', message: 'x' }));
  assert.equal(state.error, null);
  state = gameReducer(state, gameActions.failed({ key: 'anna', message: 'offline' }));
  assert.equal(state.error, 'offline');
  assert.equal(state.loaded, true, 'the last answer stays shown after a failed refresh');
  state = gameReducer(state, gameActions.refresh({ key: 'anna', ...payload }));
  assert.equal(state.error, null);
  state = gameReducer(state, gameActions.reset('ben'));
  assert.deepEqual(
    [state.key, state.loaded, state.status, state.requests, state.jokers],
    ['ben', false, null, [], null],
  );
});

test('status and details recover independently', () => {
  const key = 'hunter';
  const status = { role: 'hunter' };
  let state = gameReducer(undefined, gameActions.reset(key));
  state = gameReducer(state, gameActions.failed({ key, message: 'timetable unavailable' }));
  state = gameReducer(
    state,
    gameActions.refreshStatus({ key, status, offsetMs: 10, refreshedAt: 5 }),
  );
  assert.equal(state.status, status);
  assert.equal(state.error, 'timetable unavailable');
  assert.equal(state.statusError, null);
  assert.equal(state.loaded, false);

  state = gameReducer(state, gameActions.statusFailed({ key, message: 'status unavailable' }));
  state = gameReducer(state, gameActions.refresh({ key, requests: [], jokers: null }));
  assert.equal(state.error, null);
  assert.equal(state.statusError, 'status unavailable');
  assert.equal(state.loaded, true);
});
