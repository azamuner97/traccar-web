import { createSlice } from '@reduxjs/toolkit';
import { gameMemberKey } from '../game/gameView.js';

// The signed-in account's game view (data model 2): the computed status of /api/game-status, which also names the
// account's membership (session, member, role and number), and the member's requests, timetable pings and (players,
// supporters and hunters) jokers. `key` identifies the account the data belongs to; answers for another account
// are ignored, so one account's data never shows for another. Details belong to the member the status names
// (`memberKey`); a different member clears them.
// `membership` is 'unknown' until the first status answer, then 'member' or 'none' (the server answered 403).
const initialState = {
  key: null,
  membership: 'unknown',
  loaded: false,
  detailsLoaded: false,
  error: null,
  statusError: null,
  status: null,
  requests: [],
  jokers: null,
  timetable: [],
  offsetMs: 0,
  refreshedAt: null,
};

const clearDetails = (state) => {
  state.detailsLoaded = false;
  state.error = null;
  state.requests = [];
  state.jokers = null;
  state.timetable = [];
};

const { reducer, actions } = createSlice({
  name: 'game',
  initialState,
  reducers: {
    reset(state, action) {
      return { ...initialState, key: action.payload ?? null };
    },
    refresh(state, action) {
      const { key, memberKey, requests, jokers, timetable } = action.payload;
      if (key !== state.key || !memberKey || memberKey !== gameMemberKey(state.status)) return;
      state.detailsLoaded = true;
      state.loaded = true;
      state.error = null;
      state.requests = requests;
      state.jokers = jokers;
      state.timetable = timetable ?? [];
    },
    refreshStatus(state, action) {
      const { key, status, offsetMs, refreshedAt } = action.payload;
      if (key !== state.key) return;
      const sameMember = gameMemberKey(state.status) === gameMemberKey(status);
      if (!sameMember) clearDetails(state);
      // The hash covers the role, control and projection; an unchanged one keeps the stored status, so views
      // derived from it (such as the map filter) are not recomputed.
      if (!sameMember || !status.hash || state.status?.hash !== status.hash) {
        state.status = status;
      }
      state.membership = 'member';
      state.loaded = state.detailsLoaded;
      state.statusError = null;
      state.offsetMs = offsetMs;
      state.refreshedAt = refreshedAt;
    },
    noMembership(state, action) {
      if (action.payload.key !== state.key) return undefined;
      return { ...initialState, key: state.key, membership: 'none' };
    },
    failed(state, action) {
      if (action.payload.key !== state.key) return;
      if (action.payload.memberKey && action.payload.memberKey !== gameMemberKey(state.status))
        return;
      state.error = action.payload.message || 'Error';
    },
    statusFailed(state, action) {
      if (action.payload.key !== state.key) return;
      state.statusError = action.payload.message || 'Error';
    },
  },
});

export { actions as gameActions, reducer as gameReducer };
