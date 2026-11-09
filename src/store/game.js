import { createSlice } from '@reduxjs/toolkit';

// The signed-in member's game view: the role-filtered status, their requests, the timetable pings they
// may see and (players and supporters only) their own jokers. `key` identifies the account, role and assignment the data
// belongs to; answers for another key are ignored, so one account's data never shows for another.
const initialState = {
  key: null,
  loaded: false,
  error: null,
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
      const { key, status, requests, jokers, timetable, offsetMs, refreshedAt } = action.payload;
      if (key !== state.key) return;
      state.loaded = true;
      state.error = null;
      state.status = status;
      state.requests = requests;
      state.jokers = jokers;
      state.timetable = timetable ?? [];
      state.offsetMs = offsetMs;
      state.refreshedAt = refreshedAt;
    },
    failed(state, action) {
      if (action.payload.key !== state.key) return;
      state.error = action.payload.message || 'Error';
    },
  },
});

export { actions as gameActions, reducer as gameReducer };
