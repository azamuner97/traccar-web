import { gameNotificationsActions } from './gameNotifications.js';
import { gameNotificationCache } from '../main/gameNotificationCache.js';
import { gameNotificationAccountKey } from '../main/gameNotificationHistory.js';
import { gameAlertPermissionKey } from '../main/gameAlerts.js';
import { selectGameMembership } from '../game/gameView.js';

// Keeps the notification history bound to the member that /api/game-status names: another account or session
// deactivates it, another member of the same session (a role change) prunes what that member may not keep, and
// every change of the history is cached.
export const createGameNotificationsMiddleware =
  ({ cache = gameNotificationCache, getOrigin = () => window.location.origin } = {}) =>
  (store) =>
  (next) =>
  (action) => {
    if (
      action.type === gameNotificationsActions.add.type ||
      action.type === gameNotificationsActions.prune.type
    ) {
      action = {
        ...action,
        payload: { ...action.payload, membership: selectGameMembership(store.getState()) },
      };
    }
    const beforeMembership = selectGameMembership(store.getState());
    const before = gameNotificationAccountKey(getOrigin(), beforeMembership);
    const beforePermission = gameAlertPermissionKey(beforeMembership);
    const result = next(action);
    const membership = selectGameMembership(store.getState());
    const account = gameNotificationAccountKey(getOrigin(), membership);
    if (action.type.startsWith('gameNotifications/')) {
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
    } else if (before !== account) {
      store.dispatch(gameNotificationsActions.deactivate());
    } else if (account && beforePermission !== gameAlertPermissionKey(membership)) {
      const history = store.getState().gameNotifications;
      store.dispatch(gameNotificationsActions.prune({ key: history.key, now: Date.now() }));
    }
    return result;
  };
