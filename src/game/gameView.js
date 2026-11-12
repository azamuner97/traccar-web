// The Game page's view of the server's member endpoints of game data model 2: /api/game-status,
// /api/game-requests, /api/game-jokers and /api/game-timetable. Everything here is derived from what the
// server already computed and filtered for the signed-in member; nothing is inferred about other participants.
// Membership (session, member, role and number) comes only from /api/game-status, never from user attributes.

const gameRoles = new Set(['player', 'supporter', 'hunter', 'spectator']);

export const JOKER_TYPES = ['hunterPositions', 'break', 'fakePing'];
export const JOKER_REQUESTS = {
  hunterPositions: 'jokerHunterPositions',
  break: 'jokerBreak',
  fakePing: 'jokerFakePing',
};
// All three uses draw from the same fake-ping inventory.
export const FAKE_USES = ['timetable', 'speedhunt', 'runningSpeedhunt'];
export const OPEN_REQUEST_STATES = new Set(['pending', 'approved', 'executing']);
export const GAME_INVALIDATIONS = ['game-status', 'game-requests', 'game-jokers', 'game-timetable'];
export const SPEEDHUNT_HISTORY_INVALIDATION = 'game-speedhunt-history';
export const SPEEDHUNT_PINGS = ['speedhuntStaticPing', 'speedhuntLivePing'];
export const SPEEDHUNT_REQUESTS = [
  ...SPEEDHUNT_PINGS,
  'speedhuntStopLivePing',
  'speedhuntTerminate',
];
// The highest ping a speedhunt fake may name when speedhunts have no ping limit.
export const MAX_FAKE_PING_NUMBER = 1000;

const positiveId = (value) => (Number.isSafeInteger(value) && value > 0 ? value : null);

/**
 * The account whose game data the store holds: every signed-in account except administrators, who operate
 * games and take part in none. Whether the account is a member is known only from /api/game-status.
 */
export const gameAccountKey = (user) =>
  user && !user.administrator && positiveId(user.id) ? String(user.id) : null;

/**
 * The signed-in member as /api/game-status names them ({ userId, gameSessionId, memberId, role, number }), or
 * null for administrators, accounts without membership and while the status is not known yet.
 */
export const gameMembership = (user, game) => {
  const status = game?.status;
  const key = gameAccountKey(user);
  if (!key || game?.key !== key || !status || !gameRoles.has(status.role)) return null;
  const gameSessionId = positiveId(status.gameSessionId);
  const memberId = positiveId(status.memberId);
  if (!gameSessionId || !memberId) return null;
  return {
    userId: user.id,
    gameSessionId,
    memberId,
    role: status.role,
    number: positiveId(status.number),
  };
};

export const selectGameMembership = (state) => gameMembership(state.session?.user, state.game);

/** The member's identity (session, member and role), from a membership or a status; null without one. */
export const gameMemberKey = (value) =>
  positiveId(value?.gameSessionId) && positiveId(value?.memberId) && gameRoles.has(value?.role)
    ? JSON.stringify([value.gameSessionId, value.memberId, value.role])
    : null;

export const holdsJokers = (role) => role === 'player' || role === 'supporter';

/** Players and supporters read their own jokers; hunters read the speedhunt jokers of their shared pool. */
export const readsJokers = (role) => holdsJokers(role) || role === 'hunter';

/** The hunters' shared pool of speedhunt jokers, or null when it was not read. */
export const speedhuntPoolView = (jokers) => {
  const item = (Array.isArray(jokers?.inventories) ? jokers.inventories : []).find(
    (inventory) => inventory?.type === 'speedhunt',
  );
  if (!item) return null;
  const count = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);
  return {
    granted: count(item.granted),
    used: count(item.used),
    reserved: count(item.reserved),
    available: count(item.available),
    overAllocated: count(item.overAllocated),
  };
};

const listeners = new Set();
/** Ask game listeners to refresh, optionally naming the resources invalidated by the socket. */
export const requestGameSync = (resources) => listeners.forEach((listener) => listener(resources));
export const listenGameSync = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const isGameInvalidation = (resources) =>
  Array.isArray(resources) &&
  resources.some(
    (resource) =>
      GAME_INVALIDATIONS.includes(resource) || resource === SPEEDHUNT_HISTORY_INVALIDATION,
  );

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

export const activeHunterLiveShares = (game, user, now) => {
  if (
    gameMembership(user, game)?.role !== 'hunter' ||
    game.statusError ||
    !game.status.controllerActive ||
    !Array.isArray(game.status.status?.liveShares)
  ) {
    return [];
  }
  return game.status.status.liveShares.filter(
    (share) =>
      positiveId(share?.memberId) &&
      typeof share.name === 'string' &&
      share.name.trim() &&
      (share.endsAt == null || remainingMs(share.endsAt, game.offsetMs, now) > 0),
  );
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
  if (Number.isSafeInteger(plan?.pingNumber))
    return plan.runToken ? 'runningSpeedhunt' : 'speedhunt';
  return null;
};

/**
 * The run token of each own armed fake on a running speedhunt, by reservation: /api/game-jokers does not name
 * it, the member's status (`fakes`) does.
 */
export const ownFakeRunTokens = (status) =>
  new Map(
    (Array.isArray(status?.fakes) ? status.fakes : [])
      .filter(
        (item) =>
          positiveId(item?.reservationId) &&
          typeof item.runToken === 'string' &&
          /^[a-f0-9]{32}$/.test(item.runToken),
      )
      .map((item) => [item.reservationId, item.runToken]),
  );

/**
 * One reservation of the member: held by an open request, an armed fake or planned break (with its plan) or a
 * speedhunt fake bound to a speedhunt (used). An armed plan or one held by a cancellable request can be
 * cancelled.
 */
export const reservationView = (reservation, cancellableRequestIds, runTokens = new Map()) => {
  const fake = reservation?.fake && typeof reservation.fake === 'object' ? reservation.fake : {};
  const plannedBreak =
    reservation?.plannedBreak && typeof reservation.plannedBreak === 'object'
      ? reservation.plannedBreak
      : {};
  let kind = 'held';
  if (fake.bound === true) kind = 'bound';
  else if (reservation?.armed) kind = 'armed';
  const scheduledAt = parseTime(fake.scheduledAt) !== null ? fake.scheduledAt : null;
  // A planned break: a break joker armed for a later start (the break row owns the plan).
  const startsAt =
    reservation?.type === 'break' && parseTime(plannedBreak.startsAt) !== null
      ? plannedBreak.startsAt
      : null;
  const use = FAKE_USES.includes(reservation?.use) ? reservation.use : fakeUse(fake);
  const cancellable =
    kind === 'armed' ||
    (kind === 'held' &&
      Boolean(use || startsAt) &&
      cancellableRequestIds.has(reservation?.requestId));
  return {
    id: reservation?.id,
    reservationId: reservation?.id,
    type: reservation?.type,
    use: reservation?.type === 'fakePing' ? use : null,
    kind,
    requestId: reservation?.requestId ?? null,
    entryId: Number.isSafeInteger(fake.entryId) ? fake.entryId : null,
    scheduledAt,
    startsAt,
    pingNumber: Number.isSafeInteger(fake.pingNumber) ? fake.pingNumber : null,
    runToken: runTokens.get(reservation?.id) ?? null,
    latitude: finite(fake.latitude),
    longitude: finite(fake.longitude),
    cancellable,
  };
};

const reservationOrder = { armed: 0, held: 1, bound: 2 };

export const reservationsView = (
  jokers,
  cancellableRequestIds = new Set(),
  runTokens = new Map(),
) =>
  (Array.isArray(jokers?.reservations) ? jokers.reservations : [])
    .filter((item) => item && Number.isSafeInteger(item.id) && JOKER_TYPES.includes(item.type))
    .map((item) => reservationView(item, cancellableRequestIds, runTokens))
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

export const canCancelRequest = (request, memberId) =>
  Boolean(request) &&
  positiveId(memberId) !== null &&
  request.requesterMemberId === memberId &&
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
export const runningFakeChoice = (status) => {
  const choice = status?.runningFake;
  return choice &&
    typeof choice.runToken === 'string' &&
    /^[a-f0-9]{32}$/.test(choice.runToken) &&
    Number.isSafeInteger(choice.firstPing) &&
    Number.isSafeInteger(choice.lastPing) &&
    choice.firstPing > 1 &&
    choice.firstPing <= choice.lastPing &&
    choice.lastPing <= MAX_FAKE_PING_NUMBER
    ? choice
    : null;
};

/** Keep a picker on the run it opened with while using that run's latest available slots. */
export const selectedRunningFakeChoice = (runToken, status) => {
  const running = runningFakeChoice(status);
  return running?.runToken === runToken ? running : null;
};

export const fakeUseAvailability = ({ pings = [], reservations = [], running = null } = {}) => ({
  timetable: pings.some((item) => item.fakeAllowed && item.upcoming)
    ? usable
    : { enabled: false, reason: 'noPing' },
  speedhunt: reservations.some(
    (item) => item.type === 'fakePing' && item.use === 'speedhunt' && item.kind === 'armed',
  )
    ? { enabled: false, reason: 'planned' }
    : usable,
  runningSpeedhunt: !running
    ? { enabled: false, reason: 'noRunningHunt' }
    : reservations.some(
          (item) =>
            item.use === 'runningSpeedhunt' &&
            item.kind === 'armed' &&
            item.runToken === running.runToken,
        )
      ? { enabled: false, reason: 'runningFakePlanned' }
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
    const uses = fakeUseAvailability({ pings, reservations, running: runningFakeChoice(status) });
    if (!Object.values(uses).some((use) => use.enabled)) {
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

/** The catch roster for the signed-in player or supporter. */
export const participantOverviewView = (status) =>
  (Array.isArray(status?.participantOverview) ? status.participantOverview : [])
    .filter(
      (item) =>
        positiveId(item?.memberId) &&
        typeof item.name === 'string' &&
        holdsJokers(item.role) &&
        typeof item.caught === 'boolean',
    )
    .sort(
      (a, b) =>
        Number(a.caught) - Number(b.caught) ||
        a.name.localeCompare(b.name) ||
        a.memberId - b.memberId,
    );

/** The hunters' and spectators' roster, with each participant's speedhunt and break state. */
export const participantsView = (status, offsetMs, now = Date.now()) =>
  (Array.isArray(status?.participants) ? status.participants : [])
    .filter((item) => item && positiveId(item.memberId))
    .map((item) => {
      const speedhunt = item.speedhunt && typeof item.speedhunt === 'object' ? item.speedhunt : {};
      return {
        memberId: item.memberId,
        name: typeof item.name === 'string' && item.name ? item.name : `#${item.memberId}`,
        role: item.role,
        caught: item.caught === true,
        speedhunt: {
          running: speedhunt.running === true,
          pings: Number.isSafeInteger(speedhunt.pings) ? speedhunt.pings : 0,
          pingHistory: speedhunt.pingHistory,
          startsRun: speedhunt.startsRun ?? (speedhunt.running !== true && !speedhunt.pings),
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
export const fixedLiveMinutes = (limits) => {
  const minutes = limits?.fixedLiveMinutes;
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
};

export const speedhuntActions = (
  participant,
  { requests, controllerActive, lastSpeedhuntMemberId, limits, pool = null },
) => {
  const open = requests.some(
    (item) =>
      item.targetMemberId === participant.memberId &&
      SPEEDHUNT_REQUESTS.includes(item.type) &&
      isOpenRequest(item),
  );
  const blocked =
    !controllerActive || participant.caught || open || participant.speedhunt.revision === null;
  const ping = !blocked && participant.break.state !== 'active' && !participant.speedhunt.live;
  // A ping that starts a speedhunt needs a joker of the hunters' pool; the server reserves it.
  const noJoker = participant.speedhunt.startsRun && pool !== null && pool.available <= 0;
  let reason = null;
  if (!controllerActive) reason = 'paused';
  else if (participant.caught) reason = 'caught';
  else if (open) reason = 'open';
  else if (participant.break.state === 'active') reason = 'onBreak';
  else if (noJoker && !participant.speedhunt.live) reason = 'noSpeedhuntJoker';
  const repeat =
    participant.speedhunt.startsRun &&
    participant.memberId === lastSpeedhuntMemberId &&
    limits?.allowConsecutiveSpeedhunts === false;
  const allowsPing = (type) =>
    ping &&
    !noJoker &&
    (!repeat || (limits.limitEnforcement !== 'block' && limits.requestApprovals?.[type] === true));
  return {
    speedhuntStaticPing: allowsPing('speedhuntStaticPing'),
    speedhuntLivePing: allowsPing('speedhuntLivePing') && fixedLiveMinutes(limits) !== null,
    reason,
    repeat,
  };
};

const PING_STATES = new Set(['scheduled', 'sent', 'skipped', 'failed']);

export const timetableSlotsView = (slots, offsetMs, now = Date.now()) => {
  const current = serverNow(offsetMs, now);
  const times = new Set(
    (Array.isArray(slots) ? slots : []).map((item) => parseTime(item?.scheduledAt)),
  );
  times.delete(null);
  return [...times]
    .sort((a, b) => a - b)
    .map((time) => ({
      scheduledAt: new Date(time).toISOString(),
      upcoming: time > current,
      remainingMs: Math.max(0, time - current),
    }));
};

/**
 * The timetable pings a member sees, with the state to show: scheduled, due (its time has passed and the
 * Tool sends it), disconnected (its time has passed while no Tool runs or this page is offline), sent,
 * skipped or failed; a participant's break or caught state can mark a ping as protected or out.
 */
export const timetableView = (
  pings,
  { participants = [], offsetMs, now = Date.now(), controllerActive, connected = true } = {},
) => {
  const byMember = new Map(participants.map((item) => [item.memberId, item]));
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
      const participant = byMember.get(item.memberId);
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
        memberId: item.memberId,
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
 * The member's planned breaks, earliest first: the planned and waiting breaks of their status (cancellable
 * through their reservation until they start; due once their start has passed or they wait, when the break
 * begins as soon as possible) and the breaks for later that an open request still holds.
 */
export const plannedBreaksView = (
  status,
  requests,
  offsetMs,
  now = Date.now(),
  cancellableRequestIds = new Set(),
) => {
  const current = serverNow(offsetMs, now);
  const view = (item) => ({
    ...item,
    due: item.state === 'waiting' || parseTime(item.startsAt) <= current,
    remainingMs: remainingMs(item.startsAt, offsetMs, now),
  });
  const planned = (Array.isArray(status?.plannedBreaks) ? status.plannedBreaks : [])
    .filter(
      (item) =>
        positiveId(item?.breakId) &&
        parseTime(item.startsAt) !== null &&
        (item.state === 'planned' || item.state === 'waiting'),
    )
    .map((item) =>
      view({
        id: `break:${item.breakId}`,
        kind: 'armed',
        state: item.state,
        reservationId: positiveId(item.reservationId),
        requestId: null,
        startsAt: item.startsAt,
        cancellable: positiveId(item.reservationId) !== null,
      }),
    );
  const held = (Array.isArray(requests) ? requests : [])
    .filter(
      (item) =>
        item?.type === JOKER_REQUESTS.break &&
        isOpenRequest(item) &&
        positiveId(item.id) &&
        parseTime(item.parameters?.startsAt) !== null,
    )
    .map((item) =>
      view({
        id: `request:${item.id}`,
        kind: 'held',
        state: 'requested',
        reservationId: null,
        requestId: item.id,
        startsAt: item.parameters.startsAt,
        cancellable: cancellableRequestIds.has(item.id),
      }),
    );
  return [...planned, ...held].sort((a, b) => parseTime(a.startsAt) - parseTime(b.startsAt));
};

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
export const fakeRequest = ({ kind, entryId, pingNumber, running, latitude, longitude }) => {
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
  if (
    kind === 'runningSpeedhunt' &&
    runningFakeChoice({ runningFake: running }) &&
    Number.isSafeInteger(pingNumber) &&
    pingNumber >= running.firstPing &&
    pingNumber <= running.lastPing
  ) {
    return {
      type: JOKER_REQUESTS.fakePing,
      parameters: { runToken: running.runToken, pingNumber, ...position },
    };
  }
  return null;
};

/** Light validation of the member endpoints' answers before they reach the store. */
export const validGameStatus = (value) =>
  Boolean(
    value &&
    typeof value === 'object' &&
    positiveId(value.gameSessionId) &&
    positiveId(value.memberId) &&
    gameRoles.has(value.role) &&
    typeof value.hash === 'string' &&
    /^[0-9a-f]{32}$/.test(value.hash) &&
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
