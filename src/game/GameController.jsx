import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { gameActions } from '../store';
import fetchOrThrow from '../common/util/fetchOrThrow';
import createRefreshScheduler from '../common/util/refreshScheduler';
import {
  GAME_INVALIDATIONS,
  gameAccountKey,
  gameRole,
  readsJokers,
  listenGameSync,
  serverOffsetMs,
  validGameJokers,
  validGameStatus,
} from './gameView';

const REQUEST_LIMIT = 30;
// Without a live connection nothing announces changes, so the member endpoints are read more often.
const DISCONNECTED_REFRESH_MS = 5000;
const CONNECTED_REFRESH_MS = 30000;

/**
 * Keeps the game store current for a generated game account: on sign-in, on the server's game
 * invalidations and reconnects (through requestGameSync), when the app returns to the foreground,
 * and periodically as a fallback.
 */
const GameController = () => {
  const dispatch = useDispatch();
  const user = useSelector((state) => state.session.user);
  const socket = useSelector((state) => state.session.socket);
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const key = gameAccountKey(user);
  const role = gameRole(user);

  useEffect(() => {
    dispatch(gameActions.reset(key));
  }, [dispatch, key]);

  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    let lastLoad = 0;
    const options = { signal: controller.signal };
    const statusScheduler = createRefreshScheduler({
      load: async () => {
        lastLoad = Date.now();
        const response = await fetchOrThrow('/api/game-status', { ...options, cache: 'no-store' });
        const receivedAt = Date.now();
        const status = await response.json();
        if (!validGameStatus(status)) throw new Error('Invalid game status');
        return {
          status,
          offsetMs: serverOffsetMs(status.serverTime, receivedAt),
          refreshedAt: receivedAt,
        };
      },
      apply: (payload) => dispatch(gameActions.refreshStatus({ key, ...payload })),
      fail: (error) => {
        if (error.name !== 'AbortError')
          dispatch(gameActions.statusFailed({ key, message: error.message }));
      },
    });
    const detailsScheduler = createRefreshScheduler({
      load: async () => {
        const [requestsResponse, jokersResponse, timetableResponse] = await Promise.all([
          fetchOrThrow(`/api/game-requests?limit=${REQUEST_LIMIT}`, options),
          readsJokers(role) ? fetchOrThrow('/api/game-jokers', options) : Promise.resolve(null),
          fetchOrThrow('/api/game-timetable', options),
        ]);
        const requests = await requestsResponse.json();
        const jokers = jokersResponse ? await jokersResponse.json() : null;
        const timetable = await timetableResponse.json();
        if (
          !Array.isArray(requests) ||
          (jokers && !validGameJokers(jokers)) ||
          !Array.isArray(timetable)
        ) {
          throw new Error('Invalid game response');
        }
        return { requests, jokers, timetable };
      },
      apply: (payload) => dispatch(gameActions.refresh({ key, ...payload })),
      fail: (error) => {
        if (error.name !== 'AbortError')
          dispatch(gameActions.failed({ key, message: error.message }));
      },
    });
    const schedule = () => {
      statusScheduler.schedule();
      detailsScheduler.schedule();
    };
    const unsubscribe = listenGameSync((resources) => {
      if (!resources || resources.some((resource) => GAME_INVALIDATIONS.includes(resource))) {
        schedule();
      }
    });
    schedule();
    const interval = setInterval(() => {
      const period = socketRef.current ? CONNECTED_REFRESH_MS : DISCONNECTED_REFRESH_MS;
      if (Date.now() - lastLoad >= period) schedule();
    }, DISCONNECTED_REFRESH_MS);
    const onVisibility = () => {
      if (!document.hidden) schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      controller.abort();
      statusScheduler.cancel();
      detailsScheduler.cancel();
      unsubscribe();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [dispatch, key, role]);

  return null;
};

export default GameController;
