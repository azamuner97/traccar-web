const generatedRoles = new Set(['player', 'supporter', 'hunter', 'spectator']);
const alertTypes = new Set(['speedhunt', 'playerCaught', 'notificationTest']);
const alertMaxAgeMs = 15 * 60 * 1000;
export const gameAlertDurationMs = 60000;

export const gameAlertSessionDeviceId = (user) => {
  const value = user?.attributes?.traccarToolSessionDeviceId;
  if (
    user?.administrator ||
    !generatedRoles.has(user?.attributes?.traccarToolUserRole) ||
    !['number', 'string'].includes(typeof value) ||
    !/^[1-9][0-9]*$/.test(String(value))
  )
    return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
};

export const canReceiveGameAlert = (alert, user) =>
  Boolean(
    gameAlertSessionDeviceId(user) &&
    alert?.audience === 'session' &&
    alert.gameStateDeviceId === gameAlertSessionDeviceId(user),
  );

export const isGameAlertInWindow = (alert, maxAgeMs, now = Date.now()) => {
  const timestamp = alert?.occurredAt;
  if (
    typeof timestamp !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(timestamp)
  )
    return false;
  const time = Date.parse(timestamp);
  return (
    Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 19) === timestamp.slice(0, 19) &&
    time <= now + 60000 &&
    now - time <= maxAgeMs
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
    !/^[A-Za-z0-9_-]{1,64}$/.test(alert.id) ||
    !alertTypes.has(alert.type) ||
    alert.audience !== 'session' ||
    typeof alert.message !== 'string' ||
    !alert.message.trim() ||
    alert.message.length > 8192 ||
    typeof alert.timeZone !== 'string' ||
    !alert.timeZone.trim()
  )
    return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: alert.timeZone });
    return true;
  } catch {
    return false;
  }
};

export const replaceGameAlertQueue = (queue, key, alerts) => {
  if (!alerts.length) return queue;
  const newest = alerts.reduce((latest, alert) =>
    Date.parse(alert.occurredAt) >= Date.parse(latest.occurredAt) ? alert : latest,
  );
  return { key, alerts: [newest] };
};

export const closeGameAlertQueue = (queue, key, id, reason) =>
  reason === 'clickaway' || queue.key !== key || queue.alerts[0]?.id !== id
    ? queue
    : { key, alerts: [] };
