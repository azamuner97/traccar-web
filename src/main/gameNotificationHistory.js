import {
  canReceiveGameAlert,
  gameAlertSessionDeviceId,
  isGameAlertInWindow,
  isValidGameAlert,
} from './gameAlerts.js';

export const gameNotificationHistoryAgeMs = 24 * 60 * 60 * 1000;
export const gameNotificationHistoryLimit = 100;

export const gameNotificationHistoryKey = (origin, user) => {
  const deviceId = gameAlertSessionDeviceId(user);
  return Number.isSafeInteger(user?.id) && user.id > 0 && deviceId
    ? `traccarToolNotificationHistory:${origin}:${user.id}:${deviceId}`
    : null;
};

export const retainGameNotificationHistory = (items, user, now = Date.now()) => {
  const retained = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (
      !isValidGameAlert(item) ||
      typeof item.read !== 'boolean' ||
      !isGameAlertInWindow(item, gameNotificationHistoryAgeMs, now) ||
      !canReceiveGameAlert(item, user) ||
      retained.has(item.id)
    )
      continue;
    const record = {
      id: item.id,
      type: item.type,
      audience: item.audience,
      occurredAt: item.occurredAt,
      message: item.message,
      gameStateDeviceId: gameAlertSessionDeviceId(user),
      read: item.read,
    };
    if (Object.hasOwn(item, 'timeZone')) record.timeZone = item.timeZone;
    retained.set(item.id, record);
  }
  return [...retained.values()]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, gameNotificationHistoryLimit);
};

export const loadGameNotificationHistory = (storage, key, user, now = Date.now()) => {
  try {
    const value = JSON.parse(storage?.getItem(key) || 'null');
    return value?.version === 1 ? retainGameNotificationHistory(value.items, user, now) : [];
  } catch {
    return [];
  }
};

export const saveGameNotificationHistory = (storage, key, items) => {
  if (!key) return;
  try {
    storage?.setItem(key, JSON.stringify({ version: 1, items }));
  } catch {
    // The Redux history remains available when browser storage is restricted.
  }
};

export const formatGameNotificationTime = (alert) => {
  const timeZone = alert.timeZone || 'UTC';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
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
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}:${parts.second} (${timeZone})`;
};

export const mergeNotificationEntries = (events, notifications) =>
  [
    ...events.map((item) => ({ kind: 'event', item, time: Date.parse(item.eventTime) || 0 })),
    ...notifications.map((item) => ({ kind: 'game', item, time: Date.parse(item.occurredAt) })),
  ].sort((left, right) => right.time - left.time);
