import { useEffect, useRef } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { devicesActions, errorsActions, gameProximityActions, sessionActions } from '../store';
import createRefreshScheduler from '../common/util/refreshScheduler';
import {
  readsProximityAccess,
  readsProximityCircles,
  subscribeProximitySync,
  validProximityCircle,
} from './gameProximity';
import { gameMemberKey } from '../game/gameView';
import useGameMembership from '../game/useGameMembership';

const GameProximityController = () => {
  const dispatch = useDispatch();
  const store = useStore();
  const user = useSelector((state) => state.session.user);
  const socket = useSelector((state) => state.session.socket);
  const selectedId = useSelector((state) => state.devices.selectedId);
  const selectedRef = useRef(selectedId);
  const accessRef = useRef({ key: null, grants: [] });
  selectedRef.current = selectedId;
  // Membership (from /api/game-status) decides what proximity the account reads; the endpoints resolve the
  // member's session themselves.
  const membership = useGameMembership();
  const memberKey = gameMemberKey(membership);
  const circlesAllowed = readsProximityCircles(membership);
  const accessAllowed = readsProximityAccess(membership);
  useEffect(() => {
    dispatch(gameProximityActions.refresh({ memberKey, circles: [] }));
    const accessKey = JSON.stringify([user?.id, memberKey]);
    if (accessRef.current.key !== accessKey) {
      for (const grant of accessRef.current.grants) {
        dispatch(devicesActions.remove(grant.deviceId));
        dispatch(sessionActions.removeDeviceData(grant.deviceId));
        if (selectedRef.current === grant.deviceId) dispatch(devicesActions.selectId(null));
      }
      accessRef.current = { key: accessKey, grants: [] };
    }
    if (!user?.id) return;
    const controller = new AbortController();
    let access = accessRef.current.grants;
    const scheduler = createRefreshScheduler({
      load: async () => {
        const options = { signal: controller.signal };
        const [devicesResponse, positionsResponse, circlesResponse, accessResponse] =
          await Promise.all([
            fetch('/api/devices', options),
            fetch('/api/positions', options),
            circlesAllowed ? fetch('/api/game-proximity/circles', options) : Promise.resolve(null),
            accessAllowed ? fetch('/api/game-proximity/access', options) : Promise.resolve(null),
          ]);
        if (!devicesResponse.ok || !positionsResponse.ok)
          throw new Error('Could not refresh device access');
        const devices = await devicesResponse.json();
        const positions = await positionsResponse.json();
        const circles = circlesResponse?.ok ? await circlesResponse.json() : [];
        if (accessResponse && accessResponse.status >= 500) {
          throw new Error('Could not refresh participant proximity access');
        }
        const grants = accessResponse?.ok ? await accessResponse.json() : [];
        if (
          !Array.isArray(devices) ||
          !Array.isArray(positions) ||
          !Array.isArray(circles) ||
          !Array.isArray(grants)
        )
          throw new Error('Invalid proximity refresh response');
        return {
          devices,
          positions,
          circles: circles.filter((circle) => validProximityCircle(circle)),
          access: grants.filter(
            (grant) =>
              Number.isSafeInteger(grant.deviceId) &&
              grant.deviceId > 0 &&
              Number.isFinite(Date.parse(grant.expiresAt)),
          ),
        };
      },
      apply: ({ devices, positions, circles, access: grants }) => {
        access = grants;
        accessRef.current.grants = grants;
        const allowed = devices.map((device) => device.id);
        dispatch(devicesActions.refresh(devices));
        dispatch(sessionActions.pruneDeviceAccess(allowed));
        dispatch(
          sessionActions.updatePositions(
            positions.filter((position) => allowed.includes(position.deviceId)),
          ),
        );
        if (selectedRef.current != null && !allowed.includes(selectedRef.current))
          dispatch(devicesActions.selectId(null));
        dispatch(gameProximityActions.refresh({ memberKey, circles }));
      },
      fail: (error) => {
        if (error.name !== 'AbortError') dispatch(errorsActions.push(error.message));
      },
    });
    const unsubscribe = subscribeProximitySync(scheduler.schedule);
    scheduler.schedule();
    const interval = setInterval(scheduler.schedule, socket ? 30000 : 5000);
    let purging = false;
    const purgeExpiredAccess = () => {
      if (purging) return;
      const expired = access.filter((grant) => Date.parse(grant.expiresAt) <= Date.now());
      if (!expired.length) return;
      // Retain known deadlines until an authoritative refresh replaces them.
      // In-flight socket packets must not resurrect an expired peer marker.
      purging = true;
      try {
        for (const grant of expired) {
          const state = store.getState();
          if (state.devices.items[grant.deviceId]) dispatch(devicesActions.remove(grant.deviceId));
          if (state.session.positions[grant.deviceId] || state.session.history[grant.deviceId])
            dispatch(sessionActions.removeDeviceData(grant.deviceId));
          if (state.devices.selectedId === grant.deviceId) dispatch(devicesActions.selectId(null));
        }
      } finally {
        purging = false;
      }
    };
    const unsubscribeStore = store.subscribe(purgeExpiredAccess);
    const expiryInterval = setInterval(purgeExpiredAccess, 1000);
    return () => {
      controller.abort();
      scheduler.cancel();
      clearInterval(interval);
      clearInterval(expiryInterval);
      unsubscribeStore();
      unsubscribe();
    };
  }, [dispatch, store, user?.id, memberKey, circlesAllowed, accessAllowed, socket]);
  return null;
};
export default GameProximityController;
