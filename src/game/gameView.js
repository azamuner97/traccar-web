// The Game page's view of the server's member endpoints: /api/game-status, /api/game-requests and
// /api/game-jokers. Everything here is derived from what the server already filtered for the signed-in
// member; nothing is inferred about other participants.

const gameRoles = new Set(['player', 'supporter', 'hunter', 'spectator']);

export const JOKER_TYPES = ['hunterPositions', 'break', 'fakeTimetable', 'fakeSpeedhunt'];
export const JOKER_REQUESTS = {
  hunterPositions: 'jokerHunterPositions',
  break: 'jokerBreak',
  fakeTimetable: 'jokerFakeTimetable',
  fakeSpeedhunt: 'jokerFakeSpeedhunt',
};
export const OPEN_REQUEST_STATES = new Set(['pending', 'approved', 'executing']);
export const GAME_INVALIDATIONS = ['game-status', 'game-requests', 'game-jokers'];
// The server refuses to cancel a timetable fake this close to its ping.
export const FAKE_CANCEL_CUTOFF_MS = 60000;

/** The generated game account's role, or null for administrators and ordinary accounts. */
export const gameRole = (user) => {
  const role = user?.attributes?.traccarToolUserRole;
  return !user?.administrator && gameRoles.has(role) ? role : null;
};

export const holdsJokers = (role) => role === 'player' || role === 'supporter';

/** The account, role and assignment the game data belongs to; data for another key is never shown. */
export const gameAccountKey = (user) => {
  const role = gameRole(user);
  if (!role) return null;
  return JSON.stringify([
    user.id,
    role,
    user.attributes?.traccarToolSessionDeviceId ?? null,
    user.attributes?.traccarToolAssignedDeviceId ?? null,
  ]);
};

const listeners = new Set();
/** Ask the game controller to read the member endpoints again (socket invalidation, reconnect, foreground). */
export const requestGameSync = () => listeners.forEach((listener) => listener());
export const listenGameSync = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const isGameInvalidation = (resources) =>
  Array.isArray(resources) && resources.some((resource) => GAME_INVALIDATIONS.includes(resource));

export const parseTime = (value) => {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
};

/** How far the server's clock is ahead of this device's, from a response's serverTime. */
export const serverOffsetMs = (serverTime, receivedAt) => {
  const time = parseTime(serverTime);
  return time === null || !Number.isFinite(receivedAt) ? 0 : time - receivedAt;
};

export const serverNow = (offsetMs, now = Date.now()) =>
  now + (Number.isFinite(offsetMs) ? offsetMs : 0);

/** Milliseconds until an absolute deadline in server time, never below zero; null without a deadline. */
export const remainingMs = (deadline, offsetMs, now = Date.now()) => {
  const time = parseTime(deadline);
  return time === null ? null : Math.max(0, time - serverNow(offsetMs, now));
};

/** An absolute time of day on this device, e.g. 14:30 (or 14:30:05 with seconds). */
export const formatClock = (value, seconds = false) => {
  const time = parseTime(value);
  if (time === null) return '';
  return new Date(time).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });
};

/** Fills `{name}` placeholders of a translated text. */
export const fillText = (text, values = {}) =>
  Object.entries(values).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    String(text ?? ''),
  );

const pad = (value) => String(value).padStart(2, '0');

export const formatCountdown = (milliseconds) => {
  const total = Math.max(0, Math.ceil((milliseconds || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
};

/**
 * The member's own break: none, active until its deadline, or ending once the deadline has passed while
 * the Tool has not published its end yet (for example while no Tool controls the game).
 */
export const breakView = (published, offsetMs, now = Date.now()) => {
  if (!published || published.active !== true) return { state: 'none' };
  const endsAt = parseTime(published.endsAt);
  if (endsAt === null) return { state: 'active', endsAt: null, remainingMs: null };
  const left = endsAt - serverNow(offsetMs, now);
  return left > 0
    ? { state: 'active', endsAt: published.endsAt, remainingMs: left }
    : { state: 'ending', endsAt: published.endsAt, remainingMs: 0 };
};

/** disconnected (no live connection), loading, error, paused (no Tool runs the game) or running. */
export const connectionState = ({ socket, loaded, error, controllerActive }) => {
  if (socket === false) return 'disconnected';
  if (!loaded) return error ? 'error' : 'loading';
  return controllerActive ? 'running' : 'paused';
};

const count = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);

/** The member's jokers per type; types without an inventory count as zero. */
export const inventoryByType = (jokers) => {
  const result = Object.fromEntries(
    JOKER_TYPES.map((type) => [
      type,
      { granted: 0, used: 0, reserved: 0, available: 0, overAllocated: 0 },
    ]),
  );
  for (const item of Array.isArray(jokers?.inventories) ? jokers.inventories : []) {
    if (result[item?.type]) {
      result[item.type] = {
        granted: count(item.granted),
        used: count(item.used),
        reserved: count(item.reserved),
        available: count(item.available),
        overAllocated: count(item.overAllocated),
      };
    }
  }
  return result;
};

const finite = (value) => (Number.isFinite(value) ? value : null);

/**
 * One reservation of the member: held by an open request, an armed fake (with its plan) or a speedhunt
 * fake bound to a speedhunt (used). Armed fakes can be cancelled; a timetable fake only until shortly
 * before its ping.
 */
export const reservationView = (reservation, offsetMs, now = Date.now()) => {
  const plan = reservation?.plan && typeof reservation.plan === 'object' ? reservation.plan : {};
  let kind = 'held';
  if (reservation?.bound) kind = 'bound';
  else if (reservation?.armed) kind = 'armed';
  const scheduledAt = typeof plan.scheduledAt === 'string' ? plan.scheduledAt : null;
  const scheduled = parseTime(scheduledAt);
  let cancellable = kind === 'armed';
  if (cancellable && reservation.type === 'fakeTimetable') {
    cancellable =
      scheduled !== null && scheduled - FAKE_CANCEL_CUTOFF_MS > serverNow(offsetMs, now);
  }
  return {
    id: reservation?.id,
    type: reservation?.type,
    kind,
    requestId: reservation?.requestId ?? null,
    scheduledAt,
    pingNumber: Number.isSafeInteger(plan.pingNumber) ? plan.pingNumber : null,
    latitude: finite(plan.latitude),
    longitude: finite(plan.longitude),
    boundAt: typeof plan.boundAt === 'string' ? plan.boundAt : null,
    cancellable,
  };
};

const reservationOrder = { armed: 0, held: 1, bound: 2 };

export const reservationsView = (jokers, offsetMs, now = Date.now()) =>
  (Array.isArray(jokers?.reservations) ? jokers.reservations : [])
    .filter((item) => item && Number.isSafeInteger(item.id) && JOKER_TYPES.includes(item.type))
    .map((item) => reservationView(item, offsetMs, now))
    .sort(
      (a, b) =>
        reservationOrder[a.kind] - reservationOrder[b.kind] ||
        (parseTime(a.scheduledAt) ?? Infinity) - (parseTime(b.scheduledAt) ?? Infinity) ||
        b.id - a.id,
    );

/** The state shown for a request: waiting, awaitingApproval, approved, executing or its outcome. */
export const requestState = (request) =>
  request?.status === 'pending' && request.approvalRequired ? 'awaitingApproval' : request?.status;

export const isOpenRequest = (request) => OPEN_REQUEST_STATES.has(request?.status);

export const canCancelRequest = (request, userId) =>
  Boolean(request) &&
  request.requesterUserId === userId &&
  (request.status === 'pending' || request.status === 'approved');

export const sortedRequests = (requests) =>
  (Array.isArray(requests) ? requests : [])
    .filter((item) => item && Number.isSafeInteger(item.id))
    .sort((a, b) => b.id - a.id);

/**
 * Whether the member can use a joker now, or why not. The server checks everything again; these reasons
 * only avoid requests that would certainly be refused, and none of them depends on whom a speedhunt
 * targets (every participant sees the same speedhunt status).
 */
export const jokerAvailability = (
  type,
  { inventory, requests, status, controllerActive, offsetMs, now = Date.now() },
) => {
  if (!controllerActive) return { enabled: false, reason: 'paused' };
  if (requests.some((item) => item.type === JOKER_REQUESTS[type] && isOpenRequest(item))) {
    return { enabled: false, reason: 'open' };
  }
  if (!inventory[type]?.available) return { enabled: false, reason: 'none' };
  if (type === 'break') {
    if (breakView(status?.break, offsetMs, now).state === 'active') {
      return { enabled: false, reason: 'onBreak' };
    }
    if (status?.speedhunt?.active) return { enabled: false, reason: 'speedhunt' };
  }
  return { enabled: true, reason: null };
};

/** Light validation of the member endpoints' answers before they reach the store. */
export const validGameStatus = (value) =>
  Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.role === 'string' &&
    typeof value.controllerActive === 'boolean' &&
    parseTime(value.serverTime) !== null &&
    value.status &&
    typeof value.status === 'object',
  );

export const validGameJokers = (value) =>
  Boolean(
    value &&
    typeof value === 'object' &&
    Array.isArray(value.inventories) &&
    Array.isArray(value.reservations),
  );
