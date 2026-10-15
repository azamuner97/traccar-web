import { createSlice } from '@reduxjs/toolkit';

const defaultLiveFilter = () => ({
  statuses: [],
  groups: [],
  geofences: [],
});

const { reducer, actions } = createSlice({
  name: 'session',
  initialState: {
    server: null,
    user: null,
    socket: null,
    includeLogs: false,
    logs: [],
    positions: {},
    history: {},
    liveFilter: defaultLiveFilter(),
    liveFilterMap: false,
  },
  reducers: {
    removeDeviceData(state, action) {
      delete state.positions[action.payload];
      delete state.history[action.payload];
    },
    pruneDeviceAccess(state, action) {
      const allowed = new Set(action.payload);
      for (const deviceId of new Set([
        ...Object.keys(state.positions),
        ...Object.keys(state.history),
      ])) {
        if (!allowed.has(Number(deviceId))) {
          delete state.positions[deviceId];
          delete state.history[deviceId];
        }
      }
    },
    updateServer(state, action) {
      state.server = action.payload;
    },
    updateUser(state, action) {
      const currentUserId = state.user?.id ?? null;
      const nextUserId = action.payload?.id ?? null;
      state.user = action.payload;
      if (currentUserId !== nextUserId) {
        state.liveFilter = defaultLiveFilter();
        state.liveFilterMap = false;
      }
    },
    updateLiveFilter(state, action) {
      state.liveFilter = action.payload;
    },
    updateLiveFilterMap(state, action) {
      state.liveFilterMap = action.payload;
    },
    updateSocket(state, action) {
      state.socket = action.payload;
    },
    enableLogs(state, action) {
      state.includeLogs = action.payload;
      if (!action.payload) {
        state.logs = [];
      }
    },
    updateLogs(state, action) {
      state.logs.push(...action.payload);
    },
    updatePositions(state, action) {
      const liveRoutes =
        state.user.attributes.mapLiveRoutes || state.server.attributes.mapLiveRoutes || 'none';
      const liveRoutesLimit =
        state.user.attributes['web.liveRouteLength'] ||
        state.server.attributes['web.liveRouteLength'] ||
        10;
      action.payload.forEach((position) => {
        state.positions[position.deviceId] = position;
        if (liveRoutes !== 'none') {
          const route = state.history[position.deviceId] || [];
          const last = route.at(-1);
          if (!last || (last[0] !== position.longitude && last[1] !== position.latitude)) {
            state.history[position.deviceId] = [
              ...route.slice(1 - liveRoutesLimit),
              [position.longitude, position.latitude],
            ];
          }
        } else {
          state.history = {};
        }
      });
    },
  },
});

export { actions as sessionActions };
export { reducer as sessionReducer };
