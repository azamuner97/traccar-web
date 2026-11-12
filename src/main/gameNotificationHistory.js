import {
  canReceiveGameAlert,
  isGameAlertInWindow,
  isValidGameAlert,
  isLiveRecipientAudience,
} from './gameAlerts.js';

const positiveId = (value) => (Number.isSafeInteger(value) && value > 0 ? value : null);

export const isNotificationGeneration = (value) =>
  typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);

/** The journal of a member's session on this server, for the account (membership from /api/game-status). */
export const gameNotificationAccountKey = (origin, membership) =>
  positiveId(membership?.userId) && positiveId(membership?.gameSessionId)
    ? JSON.stringify([origin, membership.userId, membership.gameSessionId])
    : null;

export const gameNotificationHistoryKey = (origin, membership, generation) =>
  gameNotificationAccountKey(origin, membership) && isNotificationGeneration(generation)
    ? JSON.stringify([origin, membership.userId, membership.gameSessionId, generation])
    : null;

export const retainGameNotificationHistory = (items, membership, generation, now = Date.now()) => {
  const retained = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (
      !isValidGameAlert(item) ||
      typeof item.read !== 'boolean' ||
      item.generation !== generation ||
      !isGameAlertInWindow(item, Infinity, now) ||
      !canReceiveGameAlert(item, membership) ||
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
        ? { recipientMemberId: item.recipientMemberId, sourceMemberId: item.sourceMemberId }
        : {}),
      gameSessionId: item.gameSessionId,
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
