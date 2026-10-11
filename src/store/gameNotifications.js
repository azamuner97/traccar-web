import { createSlice } from '@reduxjs/toolkit';
import { retainGameNotificationHistory } from '../main/gameNotificationHistory.js';

const { reducer, actions } = createSlice({
  name: 'gameNotifications',
  initialState: { key: null, items: [], drawerVisible: false },
  reducers: {
    activate(_state, action) {
      return { key: action.payload.key, items: action.payload.items, drawerVisible: false };
    },
    add(state, { payload }) {
      if (!state.key || state.key !== payload.key) return;
      const existing = new Set(state.items.map((item) => item.id));
      const incoming = payload.items
        .filter((item) => !existing.has(item.id))
        .map((item) => ({ ...item, read: state.drawerVisible }))
        .reverse();
      state.items = retainGameNotificationHistory(
        [...incoming, ...state.items],
        payload.user,
        payload.now,
      );
    },
    setDrawerVisible(state, { payload }) {
      if (!state.key || state.key !== payload.key) return;
      state.drawerVisible = payload.visible;
      if (payload.visible)
        state.items.forEach((item) => {
          item.read = true;
        });
    },
    prune(state, { payload }) {
      if (!state.key || state.key !== payload.key) return;
      state.items = retainGameNotificationHistory(state.items, payload.user, payload.now);
    },
    delete(state, { payload }) {
      if (state.key === payload.key)
        state.items = state.items.filter((item) => item.id !== payload.id);
    },
    deleteAll(state, { payload }) {
      if (state.key === payload.key) state.items = [];
    },
  },
});

export { actions as gameNotificationsActions, reducer as gameNotificationsReducer };
