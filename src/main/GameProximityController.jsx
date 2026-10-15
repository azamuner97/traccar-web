import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { devicesActions, errorsActions, gameProximityActions, sessionActions } from '../store';
import createRefreshScheduler from '../common/util/refreshScheduler';
import { gameAlertSessionDeviceId } from './gameAlerts';
import {
  proximityCircleSessionId,
  subscribeProximitySync,
  validProximityCircle,
} from './gameProximity';

const GameProximityController = () => {
  const dispatch = useDispatch();
  const user = useSelector((state) => state.session.user);
  const socket = useSelector((state) => state.session.socket);
  const selectedId = useSelector((state) => state.devices.selectedId);
  const selectedRef = useRef(selectedId);
  const accessRef = useRef({ key: null, grants: [] });
  selectedRef.current = selectedId;
  const sessionDeviceId = proximityCircleSessionId(user);
  const role = user?.attributes?.traccarToolUserRole;
  const userSessionId = gameAlertSessionDeviceId(user);
  const assignedDeviceId = user?.attributes?.traccarToolAssignedDeviceId;
  useEffect(() => {
    dispatch(gameProximityActions.refresh({ sessionDeviceId, circles: [] }));
    const accessKey = JSON.stringify([user?.id, role, userSessionId, assignedDeviceId]);
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
            sessionDeviceId
              ? fetch(`/api/game-proximity/session/${sessionDeviceId}/circles`, options)
              : Promise.resolve(null),
            ['player', 'supporter'].includes(role) && userSessionId
              ? fetch(`/api/game-proximity/session/${userSessionId}/access`, options)
              : Promise.resolve(null),
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
        dispatch(gameProximityActions.refresh({ sessionDeviceId, circles }));
      },
      fail: (error) => {
        if (error.name !== 'AbortError') dispatch(errorsActions.push(error.message));
      },
    });
    const unsubscribe = subscribeProximitySync(scheduler.schedule);
    scheduler.schedule();
    const interval = setInterval(scheduler.schedule, socket ? 30000 : 5000);
    const expiryInterval = setInterval(() => {
      const expired = access.filter((grant) => Date.parse(grant.expiresAt) <= Date.now());
      if (expired.length) {
        access = access.filter((grant) => Date.parse(grant.expiresAt) > Date.now());
        accessRef.current.grants = access;
        for (const grant of expired) {
          dispatch(devicesActions.remove(grant.deviceId));
          dispatch(sessionActions.removeDeviceData(grant.deviceId));
          if (selectedRef.current === grant.deviceId) dispatch(devicesActions.selectId(null));
        }
      }
    }, 1000);
    return () => {
      controller.abort();
      scheduler.cancel();
      clearInterval(interval);
      clearInterval(expiryInterval);
      unsubscribe();
    };
  }, [dispatch, user?.id, role, sessionDeviceId, userSessionId, assignedDeviceId, socket]);
  return null;
};
export default GameProximityController;
