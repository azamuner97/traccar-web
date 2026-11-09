// The Game page's view of the server's member endpoints: /api/game-status, /api/game-requests and
// /api/game-jokers. Everything here is derived from what the server already filtered for the signed-in
// member; nothing is inferred about other participants.

const gameRoles = new Set(['player', 'supporter', 'hunter', 'spectator']);

export const JOKER_TYPES = ['hunterPositions', 'break', 'fakePing'];
export const JOKER_REQUESTS = {
  hunterPositions: 'jokerHunterPositions',
  break: 'jokerBreak',
  fakePing: 'jokerFakePing',
};
// One fake-ping joker is used either on a timetable ping or on a ping of the next speedhunt.
export const FAKE_USES = ['timetable', 'speedhunt'];
export const OPEN_REQUEST_STATES = new Set(['pending', 'approved', 'executing']);
export const GAME_INVALIDATIONS = ['game-status', 'game-requests', 'game-jokers', 'game-timetable'];
export const SPEEDHUNT_REQUESTS = [
  'speedhuntStaticPing',
  'speedhuntLivePing',
  'speedhuntStopLivePing',
  'speedhuntTerminate',
];
// The highest ping a speedhunt fake may name when speedhunts have no ping limit.
export const MAX_FAKE_PING_NUMBER = 1000;
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
  const startedAt = parseTime(published.startedAt) === null ? null : published.startedAt;
  if (endsAt === null) return { state: 'active', startedAt, endsAt: null, remainingMs: null };
  const left = endsAt - serverNow(offsetMs, now);
  return left > 0
    ? { state: 'active', startedAt, endsAt: published.endsAt, remainingMs: left }
    : { state: 'ending', startedAt, endsAt: published.endsAt, remainingMs: 0 };
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

/** How a fake ping is used: on a timetable ping (entryId) or on the next speedhunt (pingNumber). */
export const fakeUse = (plan) => {
  if (Number.isSafeInteger(plan?.entryId)) return 'timetable';
  if (Number.isSafeInteger(plan?.pingNumber)) return 'speedhunt';
  return null;
};

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
  // A planned break: a break joker armed (or requested) for a later start.
  const startsAt =
    reservation?.type === 'break' && parseTime(plan.startsAt) !== null ? plan.startsAt : null;
  const use = FAKE_USES.includes(reservation?.use) ? reservation.use : fakeUse(plan);
  let cancellable = kind === 'armed';
  if (cancellable && use === 'timetable') {
    cancellable =
      scheduled !== null && scheduled - FAKE_CANCEL_CUTOFF_MS > serverNow(offsetMs, now);
  }
  return {
    id: reservation?.id,
    type: reservation?.type,
    use: reservation?.type === 'fakePing' ? use : null,
    kind,
    requestId: reservation?.requestId ?? null,
    entryId: Number.isSafeInteger(plan.entryId) ? plan.entryId : null,
    scheduledAt,
    startsAt,
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
        (parseTime(a.scheduledAt ?? a.startsAt) ?? Infinity) -
          (parseTime(b.scheduledAt ?? b.startsAt) ?? Infinity) ||
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

const usable = Object.freeze({ enabled: true, reason: null });

/**
 * Whether each use of a fake-ping joker is possible now, or why not: a timetable ping needs an upcoming
 * ping that can carry a fake, and a participant has at most one fake waiting for the next speedhunt.
 */
export const fakeUseAvailability = ({ pings = [], reservations = [] } = {}) => ({
  timetable: pings.some((item) => item.fakeAllowed && item.upcoming)
    ? usable
    : { enabled: false, reason: 'noPing' },
  speedhunt: reservations.some(
    (item) => item.type === 'fakePing' && item.use === 'speedhunt' && item.kind === 'armed',
  )
    ? { enabled: false, reason: 'planned' }
    : usable,
});

/**
 * Whether the member can use a joker now, or why not. The server checks everything again; these reasons
 * only avoid requests that would certainly be refused, and none of them depends on whom a speedhunt
 * targets (every participant sees the same speedhunt status). A fake-ping joker also tells which of its
 * uses are possible (`uses`).
 */
export const jokerAvailability = (
  type,
  {
    inventory,
    requests,
    status,
    controllerActive,
    offsetMs,
    now = Date.now(),
    pings = [],
    reservations = [],
  },
) => {
  if (!controllerActive) return { enabled: false, reason: 'paused' };
  if (requests.some((item) => item.type === JOKER_REQUESTS[type] && isOpenRequest(item))) {
    return { enabled: false, reason: 'open' };
  }
  if (!inventory[type]?.available) return { enabled: false, reason: 'none' };
  if (type === 'fakePing') {
    const uses = fakeUseAvailability({ pings, reservations });
    if (!uses.timetable.enabled && !uses.speedhunt.enabled) {
      return { enabled: false, reason: 'noFakeUse', uses };
    }
    return { enabled: true, reason: null, uses };
  }
  if (type === 'break') {
    // A break can always be planned for later; only one that starts now waits for the own break to end and
    // for no speedhunt to run (every participant gets the same answer).
    let nowAvailability = usable;
    if (breakView(status?.break, offsetMs, now).state === 'active') {
      nowAvailability = { enabled: false, reason: 'onBreak' };
    } else if (status?.speedhunt?.active) {
      nowAvailability = { enabled: false, reason: 'speedhunt' };
    }
    return { enabled: true, reason: null, now: nowAvailability };
  }
  return { enabled: true, reason: null };
};

/**
 * The players and supporters of the hunters' and spectators' view, with their named speedhunt state and
 * break. Players and supporters never receive this list from the server.
 */
export const participantsView = (status, offsetMs, now = Date.now()) =>
  (Array.isArray(status?.participants) ? status.participants : [])
    .filter((item) => item && Number.isSafeInteger(item.deviceId))
    .map((item) => {
      const speedhunt = item.speedhunt && typeof item.speedhunt === 'object' ? item.speedhunt : {};
      return {
        deviceId: item.deviceId,
        name: typeof item.name === 'string' && item.name ? item.name : `#${item.deviceId}`,
        role: item.role,
        caught: item.caught === true,
        speedhunt: {
          operation: speedhunt.operation === true,
          running: speedhunt.running === true,
          pings: Number.isSafeInteger(speedhunt.pings) ? speedhunt.pings : 0,
          live: speedhunt.live === true,
          liveUntil: typeof speedhunt.liveUntil === 'string' ? speedhunt.liveUntil : null,
          revision: Number.isSafeInteger(speedhunt.revision) ? speedhunt.revision : null,
        },
        break: breakView(item.break, offsetMs, now),
      };
    })
    .sort((a, b) => Number(a.caught) - Number(b.caught) || a.name.localeCompare(b.name));

/**
 * Which shared speedhunt actions a hunter can request for a participant, mirroring the Tool's checks;
 * the Tool and the server decide.
 */
export const speedhuntActions = (participant, { requests, controllerActive }) => {
  const open = requests.some(
    (item) =>
      item.targetDeviceId === participant.deviceId &&
      SPEEDHUNT_REQUESTS.includes(item.type) &&
      isOpenRequest(item),
  );
  const blocked =
    !controllerActive || participant.caught || open || participant.speedhunt.revision === null;
  const ping = !blocked && participant.break.state !== 'active' && !participant.speedhunt.live;
  let reason = null;
  if (!controllerActive) reason = 'paused';
  else if (participant.caught) reason = 'caught';
  else if (open) reason = 'open';
  else if (participant.break.state === 'active') reason = 'onBreak';
  return {
    speedhuntStaticPing: ping,
    speedhuntLivePing: ping,
    speedhuntStopLivePing: !blocked && participant.speedhunt.live,
    speedhuntTerminate:
      !blocked && (participant.speedhunt.running || participant.speedhunt.operation),
    reason,
  };
};

const PING_STATES = new Set(['scheduled', 'sent', 'skipped', 'failed']);

/**
 * The timetable pings a member sees, with the state to show: scheduled, due (its time has passed and the
 * Tool sends it), disconnected (its time has passed while no Tool runs or this page is offline), sent,
 * skipped or failed; hunters also see protected (inside the participant's break) and out (caught).
 */
export const timetableView = (
  pings,
  { participants = [], offsetMs, now = Date.now(), controllerActive, connected = true } = {},
) => {
  const byDevice = new Map(participants.map((item) => [item.deviceId, item]));
  const current = serverNow(offsetMs, now);
  return (Array.isArray(pings) ? pings : [])
    .filter(
      (item) =>
        item &&
        Number.isSafeInteger(item.entryId) &&
        parseTime(item.scheduledAt) !== null &&
        PING_STATES.has(item.state),
    )
    .map((item) => {
      const scheduled = parseTime(item.scheduledAt);
      const participant = byDevice.get(item.deviceId);
      let state = item.state;
      if (state === 'scheduled') {
        const pause = participant?.break;
        const breakEnds = pause?.endsAt ? parseTime(pause.endsAt) : null;
        // Pings from the start of the break (or from now, when its start is unknown) to its end.
        const breakStarts = pause?.startedAt ? parseTime(pause.startedAt) : current;
        if (participant?.caught) state = 'out';
        else if (
          pause?.state === 'active' &&
          breakEnds !== null &&
          scheduled >= breakStarts &&
          scheduled < breakEnds
        ) {
          state = 'protected';
        } else if (scheduled <= current)
          state = controllerActive && connected ? 'due' : 'disconnected';
      }
      return {
        entryId: item.entryId,
        scheduledAt: item.scheduledAt,
        deviceId: item.deviceId,
        name: participant?.name ?? null,
        state,
        upcoming: scheduled > current,
        remainingMs: Math.max(0, scheduled - current),
        // The server refuses a fake on a ping inside the owner's break.
        fakeAllowed: item.fakeAllowed === true && state !== 'protected',
      };
    })
    .sort((a, b) => parseTime(a.scheduledAt) - parseTime(b.scheduledAt) || a.entryId - b.entryId);
};

/**
 * The member's planned breaks, earliest first: armed ones (cancellable until they start; due once their
 * start has passed, when the break begins as soon as possible) and ones still held by an open request.
 */
export const plannedBreaksView = (reservations, offsetMs, now = Date.now()) =>
  (Array.isArray(reservations) ? reservations : [])
    .filter((item) => item.type === 'break' && item.startsAt && item.kind !== 'bound')
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      requestId: item.requestId,
      startsAt: item.startsAt,
      due: parseTime(item.startsAt) <= serverNow(offsetMs, now),
      remainingMs: remainingMs(item.startsAt, offsetMs, now),
      cancellable: item.kind === 'armed',
    }))
    .sort((a, b) => parseTime(a.startsAt) - parseTime(b.startsAt));

/** A device-local date and time as a datetime-local input shows it, e.g. 2026-11-09T14:30. */
export const localDateTimeInput = (milliseconds) => {
  const date = new Date(milliseconds);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
};

/** The request for a break now, or planned from a datetime-local value (any time; a passed one starts now). */
export const breakRequest = ({ when, time }) => {
  if (when === 'now') return { type: JOKER_REQUESTS.break };
  if (when !== 'later' || typeof time !== 'string' || !time) return null;
  const start = new Date(time);
  if (!Number.isFinite(start.getTime())) return null;
  return { type: JOKER_REQUESTS.break, parameters: { startsAt: start.toISOString() } };
};

/** The ping numbers a speedhunt fake may name: 1 to the session's pings per speedhunt. */
export const fakePingNumbers = (pingsPerSpeedhunt) =>
  Number.isSafeInteger(pingsPerSpeedhunt) && pingsPerSpeedhunt > 0
    ? Array.from(
        { length: Math.min(pingsPerSpeedhunt, MAX_FAKE_PING_NUMBER) },
        (_, index) => index + 1,
      )
    : null;

export const validCoordinate = (latitude, longitude) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  Math.abs(latitude) <= 90 &&
  Math.abs(longitude) <= 180;

/** The request that plans a fake: on a timetable ping (entryId) or a speedhunt ping (pingNumber). */
export const fakeRequest = ({ kind, entryId, pingNumber, latitude, longitude }) => {
  if (!validCoordinate(latitude, longitude)) return null;
  const position = {
    latitude: Math.round(latitude * 1e6) / 1e6,
    longitude: Math.round(longitude * 1e6) / 1e6,
  };
  if (kind === 'timetable' && Number.isSafeInteger(entryId) && entryId > 0) {
    return { type: JOKER_REQUESTS.fakePing, parameters: { entryId, ...position } };
  }
  if (
    kind === 'speedhunt' &&
    Number.isSafeInteger(pingNumber) &&
    pingNumber >= 1 &&
    pingNumber <= MAX_FAKE_PING_NUMBER
  ) {
    return { type: JOKER_REQUESTS.fakePing, parameters: { pingNumber, ...position } };
  }
  return null;
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
