import { createSlice } from '@reduxjs/toolkit';
import { isGameStateDevice } from '../main/gameState.js';

const { reducer, actions } = createSlice({
  name: 'devices',
  initialState: {
    items: {},
    gameStateIds: {},
    selectedId: null,
    loaded: false,
  },
  reducers: {
    refresh(state, action) {
      state.items = {};
      state.gameStateIds = {};
      action.payload.forEach((item) => {
        if (isGameStateDevice(item)) {
          state.gameStateIds[item.id] = true;
        } else {
          state.items[item.id] = item;
        }
      });
      state.loaded = true;
    },
    update(state, action) {
      action.payload.forEach((item) => {
        if (isGameStateDevice(item)) {
          delete state.items[item.id];
          state.gameStateIds[item.id] = true;
        } else {
          state.items[item.id] = item;
          delete state.gameStateIds[item.id];
        }
      });
    },
    selectId(state, action) {
      state.selectTime = Date.now();
      state.selectedId = action.payload;
    },
    remove(state, action) {
      delete state.items[action.payload];
      delete state.gameStateIds[action.payload];
    },
  },
});

export { actions as devicesActions };
export { reducer as devicesReducer };
