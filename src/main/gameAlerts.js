const gameStateAttribute = 'traccarToolGameState';
const alertsVersionAttribute = 'traccarToolAlertsVersion';
const alertsAttribute = 'traccarToolAlerts';
const generatedRoleAttribute = 'traccarToolGeneratedRole';
const sessionDeviceIdAttribute = 'traccarToolSessionDeviceId';

const alertVersion = 1;
const alertMaxAgeMs = 15 * 60 * 1000;
const handledAlertMaxAgeMs = 24 * 60 * 60 * 1000;
const handledAlertLimit = 100;
const alertTypes = new Set(['speedhunt', 'playerCaught']);
const audiences = new Set(['participants', 'session']);
const participantRoles = new Set(['player', 'supporter']);
const generatedRoles = new Set(['player', 'supporter', 'hunter', 'spectator']);

export const gameAlertDurationMs = 10000;

const positiveInteger = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const belongsToGameState = (position, user) => {
  const attributes = user?.attributes;
  return Boolean(
    generatedRoles.has(attributes?.[generatedRoleAttribute]) &&
    positiveInteger(attributes?.[sessionDeviceIdAttribute]) === positiveInteger(position?.deviceId),
  );
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

  return values.filter((alert) => {
    if (
      !alert ||
      typeof alert !== 'object' ||
      typeof alert.id !== 'string' ||
      !alert.id.trim() ||
      !alertTypes.has(alert.type) ||
      !audiences.has(alert.audience) ||
      typeof alert.message !== 'string' ||
      !alert.message.trim() ||
      !canReceive(position, user, alert.audience)
    ) {
      return false;
    }
    const occurredAt = Date.parse(alert.occurredAt);
    return Number.isFinite(occurredAt) && now - occurredAt <= alertMaxAgeMs;
  });
};

export const handledGameAlertsKey = (origin, userId) =>
  `traccarToolHandledAlerts:${origin}:${userId}`;

export const loadHandledGameAlerts = (storage, key, now = Date.now()) => {
  try {
    const values = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(values)) {
      return new Map();
    }
    const retained = values
      .filter(
        (item) =>
          typeof item?.id === 'string' &&
          item.id &&
          Number.isFinite(item.handledAt) &&
          now - item.handledAt <= handledAlertMaxAgeMs,
      )
      .sort((left, right) => right.handledAt - left.handledAt)
      .slice(0, handledAlertLimit);
    return new Map(retained.map((item) => [item.id, item.handledAt]));
  } catch {
    return new Map();
  }
};

export const takeUnseenGameAlerts = (alerts, handled, now = Date.now()) => {
  for (const [id, handledAt] of handled) {
    if (now - handledAt > handledAlertMaxAgeMs) {
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
  const retained = [...handled.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, handledAlertLimit);
  handled.clear();
  retained.forEach(([id, handledAt]) => handled.set(id, handledAt));
  return unseen;
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
