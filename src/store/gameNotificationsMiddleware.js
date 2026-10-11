import { sessionActions } from './session.js';
import { gameNotificationsActions } from './gameNotifications.js';
import { gameAlertStorage } from '../main/gameAlerts.js';
import {
  gameNotificationHistoryKey,
  loadGameNotificationHistory,
  saveGameNotificationHistory,
} from '../main/gameNotificationHistory.js';

export const createGameNotificationsMiddleware =
  ({
    getStorage = gameAlertStorage,
    getOrigin = () => window.location.origin,
    now = Date.now,
  } = {}) =>
  (store) =>
  (next) =>
  (action) => {
    // Queued callbacks may capture an older role; use current authorization.
    if (
      action.type === gameNotificationsActions.add.type ||
      action.type === gameNotificationsActions.prune.type
    ) {
      action = { ...action, payload: { ...action.payload, user: store.getState().session.user } };
    }
    const result = next(action);
    const user = store.getState().session.user;
    const key = gameNotificationHistoryKey(getOrigin(), user);
    if (action.type === sessionActions.updateUser.type) {
      if (store.getState().gameNotifications.key !== key) {
        store.dispatch(
          gameNotificationsActions.activate({
            key,
            items: key ? loadGameNotificationHistory(getStorage(), key, user, now()) : [],
          }),
        );
      } else if (key) {
        store.dispatch(gameNotificationsActions.prune({ key, user, now: now() }));
      }
    } else if (key && action.type.startsWith('gameNotifications/')) {
      const history = store.getState().gameNotifications;
      if (history.key === key) saveGameNotificationHistory(getStorage(), key, history.items);
    }
    return result;
  };
