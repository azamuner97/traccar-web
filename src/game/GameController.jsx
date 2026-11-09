import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { gameActions } from '../store';
import fetchOrThrow from '../common/util/fetchOrThrow';
import createRefreshScheduler from '../common/util/refreshScheduler';
import {
  gameAccountKey,
  gameRole,
  holdsJokers,
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
    const scheduler = createRefreshScheduler({
      load: async () => {
        lastLoad = Date.now();
        const options = { signal: controller.signal };
        const [statusResponse, requestsResponse, jokersResponse] = await Promise.all([
          fetchOrThrow('/api/game-status', options),
          fetchOrThrow(`/api/game-requests?limit=${REQUEST_LIMIT}`, options),
          holdsJokers(role) ? fetchOrThrow('/api/game-jokers', options) : Promise.resolve(null),
        ]);
        const receivedAt = Date.now();
        const status = await statusResponse.json();
        const requests = await requestsResponse.json();
        const jokers = jokersResponse ? await jokersResponse.json() : null;
        if (
          !validGameStatus(status) ||
          !Array.isArray(requests) ||
          (jokers && !validGameJokers(jokers))
        ) {
          throw new Error('Invalid game response');
        }
        return {
          status,
          requests,
          jokers,
          offsetMs: serverOffsetMs(status.serverTime, receivedAt),
          refreshedAt: receivedAt,
        };
      },
      apply: (payload) => dispatch(gameActions.refresh({ key, ...payload })),
      fail: (error) => {
        if (error.name !== 'AbortError')
          dispatch(gameActions.failed({ key, message: error.message }));
      },
    });
    const unsubscribe = listenGameSync(scheduler.schedule);
    scheduler.schedule();
    const interval = setInterval(() => {
      const period = socketRef.current ? CONNECTED_REFRESH_MS : DISCONNECTED_REFRESH_MS;
      if (Date.now() - lastLoad >= period) scheduler.schedule();
    }, DISCONNECTED_REFRESH_MS);
    const onVisibility = () => {
      if (!document.hidden) scheduler.schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      controller.abort();
      scheduler.cancel();
      unsubscribe();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [dispatch, key, role]);

  return null;
};

export default GameController;
