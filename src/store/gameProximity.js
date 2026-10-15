import { createSlice } from '@reduxjs/toolkit';

const { reducer, actions } = createSlice({
  name: 'gameProximity',
  initialState: { sessionDeviceId: null, circles: [] },
  reducers: {
    refresh(state, action) {
      state.sessionDeviceId = action.payload.sessionDeviceId;
      state.circles = action.payload.circles;
    },
  },
});
export { actions as gameProximityActions, reducer as gameProximityReducer };
