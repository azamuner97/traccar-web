import { createSlice } from '@reduxjs/toolkit';

// The proximity circles of the member named by `memberKey` (session, member and role).
const { reducer, actions } = createSlice({
  name: 'gameProximity',
  initialState: { memberKey: null, circles: [] },
  reducers: {
    refresh(state, action) {
      state.memberKey = action.payload.memberKey;
      state.circles = action.payload.circles;
    },
  },
});
export { actions as gameProximityActions, reducer as gameProximityReducer };
