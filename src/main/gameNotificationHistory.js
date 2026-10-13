import {
  canReceiveGameAlert,
  gameAlertSessionDeviceId,
  isGameAlertInWindow,
  isValidGameAlert,
  isLiveRecipientAudience,
} from './gameAlerts.js';

export const isNotificationGeneration = (value) =>
  typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);

export const gameNotificationAccountKey = (origin, user) =>
  Number.isSafeInteger(user?.id) && user.id > 0 && gameAlertSessionDeviceId(user)
    ? JSON.stringify([origin, user.id, gameAlertSessionDeviceId(user)])
    : null;

export const gameNotificationHistoryKey = (origin, user, generation) =>
  gameNotificationAccountKey(origin, user) && isNotificationGeneration(generation)
    ? JSON.stringify([origin, user.id, gameAlertSessionDeviceId(user), generation])
    : null;

export const retainGameNotificationHistory = (items, user, generation, now = Date.now()) => {
  const retained = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (
      !isValidGameAlert(item) ||
      typeof item.read !== 'boolean' ||
      item.generation !== generation ||
      !isGameAlertInWindow(item, Infinity, now) ||
      !canReceiveGameAlert(item, user) ||
      retained.has(item.id)
    )
      continue;
    retained.set(item.id, {
      id: item.id,
      type: item.type,
      audience: item.audience,
      occurredAt: item.occurredAt,
      timeZone: item.timeZone,
      message: item.message,
      ...(item.audience === 'user' || isLiveRecipientAudience(item.audience)
        ? { recipientUserId: item.recipientUserId, sourceDeviceId: item.sourceDeviceId }
        : {}),
      gameStateDeviceId: item.gameStateDeviceId,
      generation,
      read: item.read,
    });
  }
  return [...retained.values()].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
};

export const formatGameNotificationTime = (alert) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: alert.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(alert.occurredAt))
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}:${parts.second} (${alert.timeZone})`;
};

export const mergeNotificationEntries = (events, notifications) =>
  [
    ...events.map((item) => ({ kind: 'event', item, time: Date.parse(item.eventTime) || 0 })),
    ...notifications.map((item) => ({ kind: 'game', item, time: Date.parse(item.occurredAt) })),
  ].sort((a, b) => b.time - a.time);
