import assert from 'node:assert/strict';
import test from 'node:test';

import { sessionActions, sessionReducer } from './session.js';

const expectedDefaultFilter = {
  statuses: [],
  groups: [],
  geofences: [],
};

const withActiveFilter = (state) => {
  let updated = sessionReducer(
    state,
    sessionActions.updateLiveFilter({
      statuses: ['online'],
      groups: [684],
      geofences: [42],
    }),
  );
  updated = sessionReducer(updated, sessionActions.updateLiveFilterMap(true));
  return updated;
};

test('live filters start empty and map filtering starts disabled', () => {
  const state = sessionReducer(undefined, { type: 'test/init' });

  assert.deepEqual(state.liveFilter, expectedDefaultFilter);
  assert.equal(state.liveFilterMap, false);
});

test('same-user updates preserve live filters within the authenticated session', () => {
  let state = sessionReducer(undefined, sessionActions.updateUser({ id: 1, name: 'Player' }));
  state = withActiveFilter(state);
  state = sessionReducer(state, sessionActions.updateUser({ id: 1, name: 'Updated player' }));

  assert.deepEqual(state.liveFilter, {
    statuses: ['online'],
    groups: [684],
    geofences: [42],
  });
  assert.equal(state.liveFilterMap, true);
});

test('switching accounts resets live filters', () => {
  let state = sessionReducer(undefined, sessionActions.updateUser({ id: 1 }));
  state = withActiveFilter(state);
  state = sessionReducer(state, sessionActions.updateUser({ id: 2 }));

  assert.deepEqual(state.liveFilter, expectedDefaultFilter);
  assert.equal(state.liveFilterMap, false);
});

test('logout or authentication expiry resets live filters', () => {
  let state = sessionReducer(undefined, sessionActions.updateUser({ id: 1 }));
  state = withActiveFilter(state);
  state = sessionReducer(state, sessionActions.updateUser(null));

  assert.deepEqual(state.liveFilter, expectedDefaultFilter);
  assert.equal(state.liveFilterMap, false);
});
