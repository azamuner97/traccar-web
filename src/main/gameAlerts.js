const generatedRoles = new Set(['player', 'supporter', 'hunter', 'spectator']);
const targetedRoles = new Set(['player', 'supporter', 'hunter']);
// The stable 'hunters' audience also includes spectators.
const namedSpeedhuntRoles = new Set(['hunter', 'spectator']);
const sessionAlertTypes = new Set(['speedhunt', 'playerCaught', 'notificationTest']);
const targetedAlertTypes = new Set([
  'geofenceExit',
  'liveTrackingStarted',
  'liveTrackingStopped',
  'liveTrackingTargetsChanged',
]);
const liveRecipientTypes = new Set(['livePingReceived', 'livePingEnded', 'livePingTargetsChanged']);
const liveRecipientAudiences = new Map([
  ['hunter', 'liveHunter'],
  ['player', 'livePlayer'],
  ['supporter', 'liveSupporter'],
  ['spectator', 'liveSpectator'],
]);
export const isLiveRecipientAudience = (audience) =>
  [...liveRecipientAudiences.values()].includes(audience);
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

const positiveId = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

const assignedDeviceId = (user) => {
  const value = user?.attributes?.traccarToolAssignedDeviceId;
  if (!['number', 'string'].includes(typeof value) || !/^[1-9][0-9]*$/.test(String(value)))
    return null;
  return positiveId(Number(value));
};

export const gameAlertPermissionKey = (user) =>
  JSON.stringify([user?.attributes?.traccarToolUserRole, assignedDeviceId(user)]);

export const canReceiveGameAlert = (alert, user) =>
  Boolean(
    gameAlertSessionDeviceId(user) &&
    alert?.gameStateDeviceId === gameAlertSessionDeviceId(user) &&
    (alert.audience === 'session' ||
      (alert.type === 'speedhunt' &&
        (alert.audience === 'hunters' || alert.audience === 'nonHunters') &&
        (alert.audience === 'hunters') ===
          namedSpeedhuntRoles.has(user?.attributes?.traccarToolUserRole)) ||
      (alert.audience === 'user' &&
        targetedRoles.has(user?.attributes?.traccarToolUserRole) &&
        alert.recipientUserId === positiveId(user?.id) &&
        alert.sourceDeviceId === assignedDeviceId(user)) ||
      (liveRecipientTypes.has(alert.type) &&
        alert.audience === liveRecipientAudiences.get(user?.attributes?.traccarToolUserRole) &&
        alert.recipientUserId === positiveId(user?.id) &&
        positiveId(alert.sourceDeviceId) !== null)),
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
    typeof alert.message !== 'string' ||
    !alert.message.trim() ||
    alert.message.length > 8192 ||
    typeof alert.timeZone !== 'string' ||
    !alert.timeZone.trim()
  )
    return false;
  const session =
    alert.audience === 'session' &&
    sessionAlertTypes.has(alert.type) &&
    !Object.hasOwn(alert, 'recipientUserId') &&
    !Object.hasOwn(alert, 'sourceDeviceId');
  const targeted =
    alert.audience === 'user' &&
    targetedAlertTypes.has(alert.type) &&
    positiveId(alert.recipientUserId) !== null &&
    positiveId(alert.sourceDeviceId) !== null;
  const role =
    alert.type === 'speedhunt' &&
    ['hunters', 'nonHunters'].includes(alert.audience) &&
    !Object.hasOwn(alert, 'recipientUserId') &&
    !Object.hasOwn(alert, 'sourceDeviceId');
  const liveRecipient =
    liveRecipientTypes.has(alert.type) &&
    isLiveRecipientAudience(alert.audience) &&
    positiveId(alert.recipientUserId) !== null &&
    positiveId(alert.sourceDeviceId) !== null &&
    (alert.type !== 'livePingTargetsChanged' || alert.audience === 'liveSpectator');
  if (!session && !targeted && !role && !liveRecipient) return false;
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
