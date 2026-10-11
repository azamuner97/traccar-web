import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { IconButton, Snackbar } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from '../common/components/LocalizationProvider';
import { gameNotificationsActions } from '../store';
import { gameNotificationCache } from './gameNotificationCache';
import { gameNotificationAccountKey } from './gameNotificationHistory';
import { createGameNotificationSync, listenGameNotificationSync } from './gameNotificationSync';
import {
  canReceiveGameAlert,
  closeGameAlertQueue,
  gameAlertDurationMs,
  isFreshGameAlert,
  replaceGameAlertQueue,
} from './gameAlerts';

const GameNotificationsController = ({ playAlarm }) => {
  const dispatch = useDispatch();
  const store = useStore();
  const t = useTranslation();
  const user = useSelector((state) => state.session.user);
  const history = useSelector((state) => state.gameNotifications);
  const account = gameNotificationAccountKey(window.location.origin, user);
  const [queue, setQueue] = useState({ key: null, alerts: [] });
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const playedRef = useRef(null);

  useEffect(() => {
    if (!account) return undefined;
    const sync = createGameNotificationSync({
      origin: window.location.origin,
      getUser: () => store.getState().session.user,
      getState: () => store.getState().gameNotifications,
      activate: (payload) => dispatch(gameNotificationsActions.activate(payload)),
      add: (payload) => dispatch(gameNotificationsActions.add(payload)),
      status: (payload) => dispatch(gameNotificationsActions.status(payload)),
      revoke: () => dispatch(gameNotificationsActions.deactivate()),
      present: (key, alerts) => setQueue((current) => replaceGameAlertQueue(current, key, alerts)),
      cache: gameNotificationCache,
      fetchPage: async (parameters, signal) => {
        const response = await fetch(`/api/game-notifications?${new URLSearchParams(parameters)}`, {
          signal,
        });
        if (!response.ok) {
          const error = new Error(`${t('gameNotificationsLoadFailed')} (${response.status})`);
          error.status = response.status;
          throw error;
        }
        return response.json();
      },
    });
    const unsubscribe = listenGameNotificationSync(sync.schedule);
    const foreground = () => {
      if (!document.hidden) sync.schedule();
    };
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('online', sync.schedule);
    sync.schedule();
    return () => {
      sync.cancel();
      unsubscribe();
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('online', sync.schedule);
    };
  }, [account, dispatch, store, t]);

  useEffect(() => {
    setQueue((current) => (current.key === history.key ? current : { key: null, alerts: [] }));
    playedRef.current = null;
  }, [account, history.key]);

  useEffect(() => {
    const update = () => {
      setVisible(!document.hidden);
      setQueue((current) => ({
        ...current,
        alerts: current.alerts.filter((alert) => isFreshGameAlert(alert)),
      }));
    };
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  const head = queue.key === history.key ? queue.alerts[0] : null;
  const active =
    canReceiveGameAlert(head, user) && head?.generation === history.generation ? head : null;
  useEffect(() => {
    if (active && !isFreshGameAlert(active)) {
      setQueue((current) => ({
        ...current,
        alerts: current.alerts.filter((alert) => isFreshGameAlert(alert)),
      }));
    } else if (visible && active && playedRef.current !== `${history.key}:${active.id}`) {
      playedRef.current = `${history.key}:${active.id}`;
      playAlarm();
    }
  }, [active, history.key, playAlarm, visible]);

  return (
    <Snackbar
      key={active?.id}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      sx={{
        zIndex: (theme) =>
          history.drawerVisible ? theme.zIndex.drawer - 1 : theme.zIndex.snackbar,
      }}
      open={visible && Boolean(active)}
      message={active?.message}
      autoHideDuration={gameAlertDurationMs}
      resumeHideDuration={gameAlertDurationMs}
      action={
        <IconButton
          size="small"
          color="inherit"
          aria-label={t('gameNotificationsDismissBanner')}
          onClick={() =>
            setQueue((current) => closeGameAlertQueue(current, history.key, active?.id, 'close'))
          }
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      }
      onClose={(_event, reason) =>
        setQueue((current) => closeGameAlertQueue(current, history.key, active?.id, reason))
      }
    />
  );
};
export default GameNotificationsController;
