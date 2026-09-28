import { createSlice } from '@reduxjs/toolkit';

const { reducer, actions } = createSlice({
  name: 'drawings',
  initialState: {
    items: {},
  },
  reducers: {
    refresh(state, action) {
      state.items = {};
      action.payload.forEach((item) => (state.items[item.id] = item));
    },
    upsert(state, action) {
      state.items[action.payload.id] = action.payload;
    },
    remove(state, action) {
      delete state.items[action.payload];
    },
  },
});

export { actions as drawingsActions };
export { reducer as drawingsReducer };
