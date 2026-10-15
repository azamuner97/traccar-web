import { combineReducers, configureStore } from '@reduxjs/toolkit';

import { errorsReducer as errors } from './errors';
import { sessionReducer as session } from './session';
import { devicesReducer as devices } from './devices';
import { eventsReducer as events } from './events';
import { gameNotificationsReducer as gameNotifications } from './gameNotifications';
import { createGameNotificationsMiddleware } from './gameNotificationsMiddleware';
import { motionReducer as motion } from './motion';
import { geofencesReducer as geofences } from './geofences';
import { groupsReducer as groups } from './groups';
import { driversReducer as drivers } from './drivers';
import { maintenancesReducer as maintenances } from './maintenances';
import { calendarsReducer as calendars } from './calendars';
import { drawingsReducer as drawings } from './drawings';
import { gameProximityReducer as gameProximity } from './gameProximity';
import throttleMiddleware from './throttleMiddleware';

const reducer = combineReducers({
  errors,
  session,
  devices,
  events,
  gameNotifications,
  motion,
  geofences,
  groups,
  drivers,
  maintenances,
  calendars,
  drawings,
  gameProximity,
});

export { errorsActions } from './errors';
export { sessionActions } from './session';
export { devicesActions } from './devices';
export { eventsActions } from './events';
export { gameNotificationsActions } from './gameNotifications';
export { motionActions } from './motion';
export { geofencesActions } from './geofences';
export { groupsActions } from './groups';
export { driversActions } from './drivers';
export { maintenancesActions } from './maintenances';
export { calendarsActions } from './calendars';
export { drawingsActions } from './drawings';
export { gameProximityActions } from './gameProximity';

export default configureStore({
  reducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(createGameNotificationsMiddleware(), throttleMiddleware),
});
