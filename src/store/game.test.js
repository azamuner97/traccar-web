import assert from 'node:assert/strict';
import test from 'node:test';
import { gameActions, gameReducer } from './game.js';

test('answers for another account are ignored and a reset clears everything', () => {
  let state = gameReducer(undefined, gameActions.reset('anna'));
  const payload = {
    status: { role: 'player' },
    requests: [{ id: 1 }],
    jokers: { inventories: [], reservations: [] },
    offsetMs: 30,
    refreshedAt: 5,
  };
  state = gameReducer(state, gameActions.refresh({ key: 'ben', ...payload }));
  assert.equal(state.loaded, false, 'a late answer for the previous account never shows');
  state = gameReducer(state, gameActions.refresh({ key: 'anna', ...payload }));
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
