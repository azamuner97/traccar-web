import {
  canReceiveGameAlert,
  gameAlertSessionDeviceId,
  isFreshGameAlert,
  isGameAlertInWindow,
  isValidGameAlert,
} from './gameAlerts.js';
import {
  gameNotificationAccountKey,
  gameNotificationHistoryKey,
  isNotificationGeneration,
  retainGameNotificationHistory,
} from './gameNotificationHistory.js';

const listeners = new Set();
export const requestGameNotificationSync = () => listeners.forEach((listener) => listener());
export const listenGameNotificationSync = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const ids = (value) => [
  ...new Set(
    (Array.isArray(value) ? value : []).filter(
      (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id),
    ),
  ),
];
const validCursor = (cursor) =>
  typeof cursor === 'string' &&
  /^[0-9]{1,19}$/.test(cursor) &&
  BigInt(cursor) <= 9223372036854775807n;

export const validateNotificationPage = (page, user, now = Date.now()) => {
  if (
    page?.version !== 1 ||
    page.sessionDeviceId !== gameAlertSessionDeviceId(user) ||
    !(page.generation === null || isNotificationGeneration(page.generation)) ||
    !Array.isArray(page.items) ||
    !validCursor(page.nextCursor) ||
    typeof page.hasMore !== 'boolean' ||
    (page.generation === null && (page.items.length || page.hasMore))
  ) {
    throw new Error('Invalid notification history response');
  }
  for (const item of page.items) {
    if (
      !isValidGameAlert(item) ||
      !isGameAlertInWindow(item, Infinity, now) ||
      !canReceiveGameAlert(item, user) ||
      item.generation !== page.generation
    ) {
      throw new Error('Invalid notification history record');
    }
  }
  return page;
};

export const createGameNotificationSync = ({
  origin,
  getUser,
  getState,
  activate,
  add,
  status,
  present,
  revoke = () => {},
  cache,
  fetchPage,
  now = Date.now,
}) => {
  const account = gameNotificationAccountKey(origin, getUser());
  let running = false;
  let requested = false;
  let cancelled = false;
  let hydrated = false;
  let controller;
  let pendingKey;
  const pending = new Map();
  const current = () =>
    !cancelled && account && account === gameNotificationAccountKey(origin, getUser());

  const hydrate = async (generation, discardPrevious = false) => {
    const key = gameNotificationHistoryKey(origin, getUser(), generation);
    if (getState().key === key) return;
    const cached = await cache.load(key);
    if (!current()) return;
    const retained = retainGameNotificationHistory(cached?.items, getUser(), generation, now());
    const deleted = ids(cached?.deleted);
    const deletedIds = new Set(deleted);
    const clearBefore = Number.isFinite(cached?.clearBefore) ? cached.clearBefore : null;
    const items = retained.filter(
      (item) =>
        !deletedIds.has(item.id) &&
        (clearBefore === null || Date.parse(item.occurredAt) > clearBefore),
    );
    const validSnapshot =
      cached?.generation === generation &&
      Array.isArray(cached.items) &&
      retained.length === cached.items.length &&
      Array.isArray(cached.handled) &&
      Array.isArray(cached.deleted) &&
      validCursor(cached.cursor);
    const previousKey = getState().key;
    activate({
      key,
      generation,
      items,
      handled: ids([...ids(cached?.handled), ...retained.map((item) => item.id)]),
      deleted,
      clearBefore,
      cursor: validSnapshot ? cached.cursor : '0',
    });
    if (discardPrevious && previousKey && previousKey !== key) await cache.remove?.(previousKey);
  };

  const cycle = async () => {
    controller = new AbortController();
    if (!hydrated) {
      const active = await cache.load(`active:${account}`);
      if (!current()) return;
      if (isNotificationGeneration(active?.generation)) await hydrate(active.generation);
      hydrated = true;
    }
    if (!current()) return;
    status({ loading: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const metadata = validateNotificationPage(
          await fetchPage(
            {
              sessionDeviceId: gameAlertSessionDeviceId(getUser()),
              limit: 1,
            },
            controller.signal,
          ),
          getUser(),
          now(),
        );
        if (!current()) return;
        if (!metadata.generation) {
          status({ loading: false });
          return;
        }
        await hydrate(metadata.generation, true);
        if (!current()) return;
        const key = gameNotificationHistoryKey(origin, getUser(), metadata.generation);
        if (pendingKey !== key) {
          pending.clear();
          pendingKey = key;
        }
        let cursor = getState().cursor;
        while (current()) {
          const page = validateNotificationPage(
            await fetchPage(
              {
                sessionDeviceId: metadata.sessionDeviceId,
                generation: metadata.generation,
                after: cursor,
                limit: 100,
              },
              controller.signal,
            ),
            getUser(),
            now(),
          );
          if (!current()) return;
          if (
            page.generation !== metadata.generation ||
            BigInt(page.nextCursor) < BigInt(cursor) ||
            (page.hasMore && BigInt(page.nextCursor) === BigInt(cursor))
          ) {
            throw new Error('Notification history cursor did not advance');
          }
          const state = getState();
          const handled = new Set([...state.handled, ...state.deleted]);
          page.items
            .filter(
              (item) =>
                !handled.has(item.id) &&
                (!state.clearBefore || Date.parse(item.occurredAt) > state.clearBefore),
            )
            .forEach((item) => pending.set(item.id, item));
          add({ key, items: page.items, user: getUser(), now: now(), cursor: page.nextCursor });
          cursor = page.nextCursor;
          if (!page.hasMore) break;
        }
        if (!current()) return;
        status({ loading: false });
        const state = getState();
        present(
          key,
          [...pending.values()].filter(
            (item) =>
              isFreshGameAlert(item, now()) &&
              !state.deleted.includes(item.id) &&
              (!state.clearBefore || Date.parse(item.occurredAt) > state.clearBefore),
          ),
        );
        pending.clear();
        return;
      } catch (error) {
        if (error.status === 409 && attempt < 2) continue;
        throw error;
      }
    }
  };

  const schedule = async () => {
    if (!current()) return;
    requested = true;
    if (running) return;
    running = true;
    try {
      while (requested && current()) {
        requested = false;
        try {
          await cycle();
        } catch (error) {
          if (current() && error.name !== 'AbortError') {
            if (error.status === 401 || error.status === 403) {
              pending.clear();
              revoke();
            }
            status({ loading: false, error: error.message });
          }
        }
      }
    } finally {
      running = false;
    }
  };
  return {
    schedule,
    cancel: () => {
      cancelled = true;
      requested = false;
      controller?.abort();
    },
  };
};
