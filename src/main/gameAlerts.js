const gameStateAttribute = 'traccarToolGameState';
const alertsVersionAttribute = 'traccarToolAlertsVersion';
const alertsAttribute = 'traccarToolAlerts';
const generatedRoleAttribute = 'traccarToolUserRole';
const sessionDeviceIdAttribute = 'traccarToolSessionDeviceId';

const alertVersion = 1;
const alertMaxAgeMs = 15 * 60 * 1000;
const futureToleranceMs = 60 * 1000;
const handledAlertMaxAgeMs = 24 * 60 * 60 * 1000;
const handledAlertLimit = 100;
const typeAudiences = {
  // Keep old participant-only records readable without widening their audience.
  speedhunt: ['participants', 'session'],
  playerCaught: ['session'],
  notificationTest: ['session'],
};
const participantRoles = new Set(['player', 'supporter']);
const generatedRoles = new Set(['player', 'supporter', 'hunter', 'spectator']);

export const gameAlertDurationMs = 60000;

const positiveInteger = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const gameAlertSessionDeviceId = (user) =>
  !user?.administrator && generatedRoles.has(user?.attributes?.[generatedRoleAttribute])
    ? positiveInteger(user.attributes[sessionDeviceIdAttribute])
    : null;

const belongsToGameState = (position, user) => {
  const attributes = user?.attributes;
  const sessionDeviceId = positiveInteger(attributes?.[sessionDeviceIdAttribute]);
  return Boolean(
    !user?.administrator &&
    sessionDeviceId &&
    generatedRoles.has(attributes?.[generatedRoleAttribute]) &&
    sessionDeviceId === positiveInteger(position?.deviceId),
  );
};

export const isGameAlertInWindow = (alert, maxAgeMs, now = Date.now()) => {
  const timestamp = alert?.occurredAt;
  if (
    typeof timestamp !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(timestamp)
  ) {
    return false;
  }
  const occurredAt = Date.parse(timestamp);
  return (
    Number.isFinite(occurredAt) &&
    new Date(occurredAt).toISOString().slice(0, 19) === timestamp.slice(0, 19) &&
    occurredAt - now <= futureToleranceMs &&
    now - occurredAt <= maxAgeMs
  );
};

export const isFreshGameAlert = (alert, now = Date.now()) =>
  isGameAlertInWindow(alert, alertMaxAgeMs, now);

export const isValidGameAlert = (alert) => {
  if (
    !alert ||
    typeof alert !== 'object' ||
    Array.isArray(alert) ||
    typeof alert.id !== 'string' ||
    !alert.id.trim() ||
    typeof alert.type !== 'string' ||
    !Object.hasOwn(typeAudiences, alert.type) ||
    !typeAudiences[alert.type].includes(alert.audience) ||
    typeof alert.message !== 'string' ||
    !alert.message.trim()
  )
    return false;
  if (Object.hasOwn(alert, 'timeZone')) {
    if (typeof alert.timeZone !== 'string' || !alert.timeZone.trim()) return false;
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: alert.timeZone });
    } catch {
      return false;
    }
  }
  return true;
};

const canReceive = (position, user, audience) => {
  if (!belongsToGameState(position, user)) {
    return false;
  }
  if (audience === 'participants') {
    return participantRoles.has(user.attributes?.[generatedRoleAttribute]);
  }
  return audience === 'session';
};

export const canReceiveGameAlert = (alert, user) =>
  canReceive({ deviceId: alert?.gameStateDeviceId }, user, alert?.audience);

export const parseGameAlerts = (position, user, now = Date.now()) => {
  const attributes = position?.attributes;
  if (
    attributes?.[gameStateAttribute] !== true ||
    attributes?.[alertsVersionAttribute] !== alertVersion ||
    typeof attributes?.[alertsAttribute] !== 'string'
  ) {
    return [];
  }

  let values;
  try {
    values = JSON.parse(attributes[alertsAttribute]);
  } catch {
    return [];
  }
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter(
    (alert) =>
      isValidGameAlert(alert) &&
      canReceive(position, user, alert.audience) &&
      isFreshGameAlert(alert, now),
  );
};

export const gameAlertStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const retainHandled = (entries, now) =>
  entries
    .filter(
      ([id, handledAt]) =>
        typeof id === 'string' &&
        id.trim() &&
        Number.isFinite(handledAt) &&
        handledAt <= now + futureToleranceMs &&
        now - handledAt <= handledAlertMaxAgeMs,
    )
    .sort((left, right) => left[1] - right[1])
    .slice(-handledAlertLimit);

export const handledGameAlertsKey = (origin, userId) =>
  `traccarToolHandledAlerts:${origin}:${userId}`;

export const loadHandledGameAlerts = (storage, key, now = Date.now()) => {
  try {
    const values = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(values)) {
      return new Map();
    }
    return new Map(
      retainHandled(
        values.map((item) => [item?.id, item?.handledAt]),
        now,
      ),
    );
  } catch {
    return new Map();
  }
};

export const takeUnseenGameAlerts = (alerts, handled, now = Date.now()) => {
  for (const [id, handledAt] of handled) {
    if (now - handledAt > handledAlertMaxAgeMs || handledAt > now + futureToleranceMs) {
      handled.delete(id);
    }
  }
  const unseen = alerts.filter((alert) => {
    if (handled.has(alert.id)) {
      return false;
    }
    handled.set(alert.id, now);
    return true;
  });
  const retained = retainHandled([...handled.entries()], now);
  handled.clear();
  retained.forEach(([id, handledAt]) => handled.set(id, handledAt));
  return unseen;
};

export const replaceGameAlertQueue = (queue, key, alerts) => {
  if (!alerts.length) return queue;
  // All unseen alerts enter history, but only the newest gets a banner. In a
  // replay batch, timestamps determine recency; equal timestamps favor the last
  // arrival. Superseded banners must not reappear after closing the new one.
  const newest = alerts.reduce((latest, alert) =>
    Date.parse(alert.occurredAt) >= Date.parse(latest.occurredAt) ? alert : latest,
  );
  return { key, alerts: [newest] };
};

export const closeGameAlertQueue = (queue, key, id, reason) => {
  if (reason === 'clickaway' || queue.key !== key || queue.alerts[0]?.id !== id) return queue;
  return { key, alerts: queue.alerts.slice(1) };
};

export const saveHandledGameAlerts = (storage, key, handled) => {
  try {
    storage.setItem(
      key,
      JSON.stringify([...handled.entries()].map(([id, handledAt]) => ({ id, handledAt }))),
    );
  } catch {
    // Keep in-memory deduplication when storage is unavailable.
  }
};
