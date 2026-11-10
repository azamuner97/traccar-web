import { createSlice } from '@reduxjs/toolkit';

// The signed-in member's game view: the role-filtered status, their requests, the timetable pings they
// may see and (players and supporters only) their own jokers. `key` identifies the account, role and assignment the data
// belongs to; answers for another key are ignored, so one account's data never shows for another.
const initialState = {
  key: null,
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

const { reducer, actions } = createSlice({
  name: 'game',
  initialState,
  reducers: {
    reset(state, action) {
      return { ...initialState, key: action.payload ?? null };
    },
    refresh(state, action) {
      const { key, requests, jokers, timetable } = action.payload;
      if (key !== state.key) return;
      state.detailsLoaded = true;
      state.loaded = Boolean(state.status);
      state.error = null;
      state.requests = requests;
      state.jokers = jokers;
      state.timetable = timetable ?? [];
    },
    refreshStatus(state, action) {
      const { key, status, offsetMs, refreshedAt } = action.payload;
      if (key !== state.key) return;
      state.loaded = state.detailsLoaded;
      state.statusError = null;
      state.status = status;
      state.offsetMs = offsetMs;
      state.refreshedAt = refreshedAt;
    },
    failed(state, action) {
      if (action.payload.key !== state.key) return;
      state.error = action.payload.message || 'Error';
    },
    statusFailed(state, action) {
      if (action.payload.key !== state.key) return;
      state.statusError = action.payload.message || 'Error';
    },
  },
});

export { actions as gameActions, reducer as gameReducer };
