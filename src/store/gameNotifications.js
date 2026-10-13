import { createSlice } from '@reduxjs/toolkit';
import { retainGameNotificationHistory } from '../main/gameNotificationHistory.js';

export const emptyGameNotificationState = () => ({
  key: null,
  generation: null,
  permission: null,
  items: [],
  handled: [],
  deleted: [],
  clearBefore: null,
  cursor: '0',
  drawerVisible: false,
  loading: false,
  error: null,
});

const { reducer, actions } = createSlice({
  name: 'gameNotifications',
  initialState: emptyGameNotificationState(),
  reducers: {
    deactivate: () => emptyGameNotificationState(),
    activate(state, { payload }) {
      const drawerVisible = state.key === payload.key && state.drawerVisible;
      return {
        ...emptyGameNotificationState(),
        ...payload,
        drawerVisible,
        items: (payload.items || []).map((item) => ({ ...item, read: drawerVisible || item.read })),
      };
    },
    status(state, { payload }) {
      state.loading = payload.loading;
      state.error = payload.error || null;
    },
    add(state, { payload }) {
      if (!state.key || state.key !== payload.key) return;
      const handled = new Set(state.handled);
      const deleted = new Set(state.deleted);
      const existing = new Set(state.items.map((item) => item.id));
      const incoming = [];
      for (const item of payload.items) {
        handled.add(item.id);
        if (
          !existing.has(item.id) &&
          !deleted.has(item.id) &&
          (!state.clearBefore || Date.parse(item.occurredAt) > state.clearBefore)
        ) {
          incoming.push({ ...item, read: state.drawerVisible });
          existing.add(item.id);
        }
      }
      state.items = retainGameNotificationHistory(
        [...incoming, ...state.items],
        payload.user,
        state.generation,
        payload.now,
      );
      state.handled = [...handled];
      state.cursor = payload.cursor;
    },
    setDrawerVisible(state, { payload }) {
      if (state.key !== payload.key) return;
      state.drawerVisible = payload.visible;
      if (payload.visible)
        state.items.forEach((item) => {
          item.read = true;
        });
    },
    prune(state, { payload }) {
      if (state.key !== payload.key) return;
      state.items = retainGameNotificationHistory(
        state.items,
        payload.user,
        state.generation,
        payload.now,
      );
    },
    delete(state, { payload }) {
      if (state.key !== payload.key) return;
      if (!state.deleted.includes(payload.id)) state.deleted.push(payload.id);
      state.items = state.items.filter((item) => item.id !== payload.id);
    },
    deleteAll(state, { payload }) {
      if (state.key !== payload.key) return;
      state.deleted = [...new Set([...state.deleted, ...state.items.map((item) => item.id)])];
      state.clearBefore = Math.max(payload.now, state.clearBefore || 0);
      state.items = [];
    },
  },
});
export { actions as gameNotificationsActions, reducer as gameNotificationsReducer };
