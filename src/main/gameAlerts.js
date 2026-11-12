// Game alerts of data model 2. Who may receive an alert follows the membership that /api/game-status names
// ({ userId, gameSessionId, memberId, role }), never user attributes: recipients and sources are members.
const memberRoles = new Set(['player', 'supporter', 'hunter', 'spectator']);
const targetedRoles = new Set(['player', 'supporter', 'hunter']);
// The stable 'hunters' audience also includes spectators.
const namedSpeedhuntRoles = new Set(['hunter', 'spectator']);
const sessionAlertTypes = new Set(['speedhunt', 'playerCaught', 'notificationTest']);
const targetedAlertTypes = new Set([
  'participantProximityEnter',
  'participantProximityExit',
  'participantProximityConsequence',
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

const positiveId = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

/**
 * What decides which retained alerts a member may keep: their role and member. A role change makes a new
 * member, whose personal history starts empty; a tracker replacement keeps the member and their history.
 */
export const gameAlertPermissionKey = (membership) =>
  membership ? JSON.stringify([membership.role, membership.memberId]) : null;

/**
 * Whether the member may receive an alert of their session (stamped `gameSessionId` from the page that carried
 * it): session alerts, their role group's alerts, targeted alerts about themselves (recipient and source are the
 * member) and live-recipient alerts for their role.
 */
export const canReceiveGameAlert = (alert, membership) =>
  Boolean(
    positiveId(membership?.gameSessionId) &&
    positiveId(membership?.memberId) &&
    memberRoles.has(membership.role) &&
    alert?.gameSessionId === membership.gameSessionId &&
    (alert.audience === 'session' ||
      (['speedhunt', 'participantProximityConsequence'].includes(alert.type) &&
        (alert.audience === 'hunters' || alert.audience === 'nonHunters') &&
        (alert.audience === 'hunters') === namedSpeedhuntRoles.has(membership.role)) ||
      (alert.audience === 'user' &&
        targetedRoles.has(membership.role) &&
        alert.recipientMemberId === membership.memberId &&
        alert.sourceMemberId === membership.memberId) ||
      (liveRecipientTypes.has(alert.type) &&
        alert.audience === liveRecipientAudiences.get(membership.role) &&
        alert.recipientMemberId === membership.memberId &&
        positiveId(alert.sourceMemberId) !== null &&
        alert.sourceMemberId !== membership.memberId)),
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
  // Session and role alerts name no member; a targeted alert is about its recipient (recipient = source);
  // a live-recipient alert is about another member whose positions the recipient receives.
  const anonymous = alert.recipientMemberId == null && alert.sourceMemberId == null;
  const session = alert.audience === 'session' && sessionAlertTypes.has(alert.type) && anonymous;
  const targeted =
    alert.audience === 'user' &&
    targetedAlertTypes.has(alert.type) &&
    positiveId(alert.recipientMemberId) !== null &&
    alert.sourceMemberId === alert.recipientMemberId;
  const role =
    ['speedhunt', 'participantProximityConsequence'].includes(alert.type) &&
    ['hunters', 'nonHunters'].includes(alert.audience) &&
    (alert.type !== 'participantProximityConsequence' || alert.audience === 'hunters') &&
    anonymous;
  const liveRecipient =
    liveRecipientTypes.has(alert.type) &&
    isLiveRecipientAudience(alert.audience) &&
    positiveId(alert.recipientMemberId) !== null &&
    positiveId(alert.sourceMemberId) !== null &&
    alert.recipientMemberId !== alert.sourceMemberId &&
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
