import { sessionActions } from './session.js';
import { gameNotificationsActions } from './gameNotifications.js';
import { gameNotificationCache } from '../main/gameNotificationCache.js';
import { gameNotificationAccountKey } from '../main/gameNotificationHistory.js';

export const createGameNotificationsMiddleware =
  ({ cache = gameNotificationCache, getOrigin = () => window.location.origin } = {}) =>
  (store) =>
  (next) =>
  (action) => {
    if (
      action.type === gameNotificationsActions.add.type ||
      action.type === gameNotificationsActions.prune.type
    ) {
      action = { ...action, payload: { ...action.payload, user: store.getState().session.user } };
    }
    const before = gameNotificationAccountKey(getOrigin(), store.getState().session.user);
    const result = next(action);
    const user = store.getState().session.user;
    const account = gameNotificationAccountKey(getOrigin(), user);
    if (action.type === sessionActions.updateUser.type) {
      if (before !== account) store.dispatch(gameNotificationsActions.deactivate());
      else if (account) {
        const history = store.getState().gameNotifications;
        store.dispatch(gameNotificationsActions.prune({ key: history.key, user, now: Date.now() }));
      }
    } else if (action.type.startsWith('gameNotifications/')) {
      const history = store.getState().gameNotifications;
      if (account && history.key)
        cache.save(history.key, {
          generation: history.generation,
          permission: history.permission,
          items: history.items,
          handled: history.handled,
          deleted: history.deleted,
          clearBefore: history.clearBefore,
          cursor: history.cursor,
        });
      if (account && history.key)
        cache.save(`active:${account}`, { generation: history.generation });
    }
    return result;
  };
