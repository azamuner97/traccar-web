import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Snackbar } from '@mui/material';
import {
  devicesActions,
  drawingsActions,
  errorsActions,
  geofencesActions,
  sessionActions,
} from './store';
import { useCatchCallback } from './reactHelper';
import { snackBarDurationLongMs } from './common/util/duration';
import alarm from './resources/alarm.mp3';
import { eventsActions } from './store/events';
import useFeatures from './common/util/useFeatures';
import { useAttributePreference } from './common/util/preferences';
import {
  handleNativeNotificationListeners,
  nativePostMessage,
} from './common/components/NativeInterface';
import fetchOrThrow from './common/util/fetchOrThrow';
import createRefreshScheduler from './common/util/refreshScheduler';
import GameNotificationsController from './main/GameNotificationsController';
import { requestGameNotificationSync } from './main/gameNotificationSync';

const logoutCode = 4000;

let alarmAudio;
const playAlarm = () => {
  try {
    if (!alarmAudio) {
      alarmAudio = new Audio(alarm);
    }
    alarmAudio.currentTime = 0;
    alarmAudio.play().catch(() => {});
  } catch {
    // Sound is best-effort when browser/WebView autoplay is restricted.
  }
};

const SocketController = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const user = useSelector((state) => state.session.user);
  const authenticated = Boolean(user);
  const includeLogs = useSelector((state) => state.session.includeLogs);
  const userRef = useRef(user);
  userRef.current = user;
  const includeLogsRef = useRef(includeLogs);
  includeLogsRef.current = includeLogs;

  const socketRef = useRef();
  const reconnectTimeoutRef = useRef();

  const geofenceRefreshScheduler = useMemo(
    () =>
      createRefreshScheduler({
        load: async () => {
          const response = await fetchOrThrow('/api/geofences');
          return response.json();
        },
        apply: (geofences) => dispatch(geofencesActions.refresh(geofences)),
        fail: (error) => dispatch(errorsActions.push(error.message)),
      }),
    [dispatch],
  );

  const drawingRefreshScheduler = useMemo(
    () =>
      createRefreshScheduler({
        load: async () => {
          const response = await fetchOrThrow('/api/drawings');
          return response.json();
        },
        apply: (drawings) => dispatch(drawingsActions.refresh(drawings)),
        fail: (error) => dispatch(errorsActions.push(error.message)),
      }),
    [dispatch],
  );

  const userRefreshScheduler = useMemo(
    () =>
      createRefreshScheduler({
        load: async () => {
          const response = await fetchOrThrow('/api/session');
          return response.json();
        },
        apply: (user) => dispatch(sessionActions.updateUser(user)),
        fail: (error) => dispatch(errorsActions.push(error.message)),
      }),
    [dispatch],
  );

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const [notifications, setNotifications] = useState([]);
  const soundEvents = useAttributePreference('soundEvents', '');
  const soundAlarms = useAttributePreference('soundAlarms', 'sos');

  const features = useFeatures();

  const handleEvents = useCallback(
    (events) => {
      if (!features.disableEvents) {
        dispatch(eventsActions.add(events));
      }
      if (
        events.some(
          (e) =>
            soundEvents.includes(e.type) ||
            (e.type === 'alarm' && soundAlarms.includes(e.attributes.alarm)),
        )
      ) {
        playAlarm();
      }
      setNotifications(
        events.map((event) => ({
          id: event.id,
          message: event.attributes.message,
          show: true,
        })),
      );
    },
    [features, dispatch, soundEvents, soundAlarms],
  );

  const handleEventsRef = useRef(handleEvents);
  handleEventsRef.current = handleEvents;

  const connectSocketRef = useRef();

  const connectSocket = useCallback(() => {
    const accountId = userRef.current?.id;
    if (!accountId) return;
    clearReconnectTimeout();
    if (socketRef.current && socketRef.current.readyState !== WebSocket.CLOSED) {
      socketRef.current.close();
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/socket`);
    socketRef.current = socket;
    const isCurrent = () => socketRef.current === socket && userRef.current?.id === accountId;

    socket.onopen = () => {
      if (!isCurrent()) return;
      dispatch(sessionActions.updateSocket(true));
      requestGameNotificationSync();
      socket.send(JSON.stringify({ logs: includeLogsRef.current }));
      geofenceRefreshScheduler.schedule();
      drawingRefreshScheduler.schedule();
    };

    socket.onclose = async (event) => {
      if (!isCurrent()) return;
      dispatch(sessionActions.updateSocket(false));
      if (event.code === logoutCode) return;
      try {
        const devicesResponse = await fetch('/api/devices');
        if (!isCurrent()) return;
        if (devicesResponse.ok) {
          const devices = await devicesResponse.json();
          if (!isCurrent()) return;
          dispatch(devicesActions.update(devices));
        }
        const positionsResponse = await fetch('/api/positions');
        if (!isCurrent()) return;
        if (positionsResponse.ok) {
          const positions = await positionsResponse.json();
          if (!isCurrent()) return;
          dispatch(sessionActions.updatePositions(positions));
        }
        if (devicesResponse.status === 401 || positionsResponse.status === 401) {
          clearReconnectTimeout();
          dispatch(sessionActions.updateUser(null));
          navigate('/login');
          return;
        }
      } catch {
        // ignore errors
      }
      if (!isCurrent()) return;
      clearReconnectTimeout();
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connectSocketRef.current?.();
      }, 60000);
    };

    socket.onmessage = (event) => {
      if (!isCurrent()) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!data || typeof data !== 'object') return;
      if (Array.isArray(data.devices)) {
        dispatch(devicesActions.update(data.devices));
      }
      if (Array.isArray(data.positions)) {
        dispatch(sessionActions.updatePositions(data.positions));
      }
      if (Array.isArray(data.events)) {
        handleEventsRef.current(data.events);
      }
      if (data.logs) {
        dispatch(sessionActions.updateLogs(data.logs));
      }
      if (Array.isArray(data.invalidate) && data.invalidate.includes('geofences')) {
        geofenceRefreshScheduler.schedule();
      }
      if (Array.isArray(data.invalidate) && data.invalidate.includes('drawings')) {
        drawingRefreshScheduler.schedule();
      }
      if (Array.isArray(data.invalidate) && data.invalidate.includes('game-notifications')) {
        requestGameNotificationSync();
      }
      if (Array.isArray(data.invalidate) && data.invalidate.includes('user')) {
        userRefreshScheduler.schedule();
      }
    };
  }, [
    clearReconnectTimeout,
    dispatch,
    drawingRefreshScheduler,
    geofenceRefreshScheduler,
    navigate,
    userRefreshScheduler,
  ]);

  connectSocketRef.current = connectSocket;

  useEffect(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ logs: includeLogs }));
    }
  }, [includeLogs]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const controller = new AbortController();
    const initialize = async () => {
      try {
        const response = await fetchOrThrow('/api/devices', { signal: controller.signal });
        const devices = await response.json();
        if (controller.signal.aborted) return;
        dispatch(devicesActions.refresh(devices));
        nativePostMessage('authenticated');
        connectSocket();
      } catch (error) {
        if (!controller.signal.aborted) dispatch(errorsActions.push(error.message));
      }
    };
    initialize();
    return () => {
      controller.abort();
      clearReconnectTimeout();
      geofenceRefreshScheduler.cancel();
      drawingRefreshScheduler.cancel();
      userRefreshScheduler.cancel();
      dispatch(drawingsActions.refresh([]));
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close(logoutCode);
      dispatch(sessionActions.updateSocket(false));
    };
  }, [
    user?.id,
    dispatch,
    clearReconnectTimeout,
    connectSocket,
    drawingRefreshScheduler,
    geofenceRefreshScheduler,
    userRefreshScheduler,
  ]);

  const handleNativeNotification = useCatchCallback(
    async (message) => {
      const accountId = userRef.current?.id;
      const eventId = message?.data?.eventId;
      if (accountId && eventId) {
        const response = await fetch(`/api/events/${eventId}`);
        if (response.ok) {
          const event = await response.json();
          if (userRef.current?.id !== accountId) return;
          const eventWithMessage = {
            ...event,
            attributes: { ...event.attributes, message: message.notification?.body },
          };
          handleEvents([eventWithMessage]);
        }
      }
    },
    [handleEvents],
  );

  useEffect(() => {
    handleNativeNotificationListeners.add(handleNativeNotification);
    return () => handleNativeNotificationListeners.delete(handleNativeNotification);
  }, [handleNativeNotification]);

  useEffect(() => {
    if (!authenticated) return;
    const reconnectIfNeeded = () => {
      const socket = socketRef.current;
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        connectSocket();
      } else if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send('{}');
        } catch {
          // test connection
        }
      }
    };
    const onVisibility = () => {
      if (!document.hidden) {
        reconnectIfNeeded();
      }
    };
    window.addEventListener('online', reconnectIfNeeded);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', reconnectIfNeeded);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [authenticated, connectSocket]);

  return (
    <>
      {notifications.map((notification) => (
        <Snackbar
          key={notification.id}
          open={notification.show}
          message={notification.message}
          autoHideDuration={snackBarDurationLongMs}
          onClose={() => setNotifications((prev) => prev.filter((e) => e.id !== notification.id))}
        />
      ))}
      <GameNotificationsController playAlarm={playAlarm} />
    </>
  );
};

export default SocketController;
