import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItem,
  ListItemText,
  Toolbar,
  Typography,
} from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import { formatNotificationTitle, formatTime } from '../common/util/formatter';
import { useTranslation } from '../common/components/LocalizationProvider';
import { eventsActions, gameNotificationsActions } from '../store';
import { formatGameNotificationTime, mergeNotificationEntries } from './gameNotificationHistory';
import useFeatures from '../common/util/useFeatures';

const useStyles = makeStyles()((theme) => ({
  drawer: {
    width: theme.dimensions.eventsDrawerWidth,
  },
  toolbar: {
    paddingLeft: theme.spacing(2),
    paddingRight: theme.spacing(2),
  },
  title: {
    flexGrow: 1,
  },
}));

const EventsDrawer = ({ open, onClose }) => {
  const { classes } = useStyles();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const t = useTranslation();
  const features = useFeatures();

  const devices = useSelector((state) => state.devices.items);

  const events = useSelector((state) => state.events.items);
  const history = useSelector((state) => state.gameNotifications);
  const user = useSelector((state) => state.session.user);
  const entries = mergeNotificationEntries(features.disableEvents ? [] : events, history.items);

  useEffect(() => {
    const update = () => {
      dispatch(
        gameNotificationsActions.prune({
          key: history.key,
          user,
          now: Date.now(),
        }),
      );
      dispatch(
        gameNotificationsActions.setDrawerVisible({
          key: history.key,
          visible: open && document.visibilityState === 'visible',
        }),
      );
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      dispatch(gameNotificationsActions.setDrawerVisible({ key: history.key, visible: false }));
    };
  }, [dispatch, history.key, open, user]);

  const formatType = (event) =>
    formatNotificationTitle(t, {
      type: event.type,
      attributes: {
        alarms: event.attributes.alarm,
      },
    });

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Toolbar className={classes.toolbar} disableGutters>
        <Typography variant="h6" className={classes.title}>
          {t('reportEvents')}
        </Typography>
        <IconButton
          size="small"
          color="inherit"
          aria-label={t('gameNotificationsClearHistory')}
          onClick={() => {
            dispatch(eventsActions.deleteAll());
            dispatch(gameNotificationsActions.deleteAll({ key: history.key }));
          }}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" aria-label={t('gameNotificationsCloseHistory')} onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Toolbar>
      <List className={classes.drawer} dense>
        {entries.length === 0 && (
          <ListItem>
            <ListItemText primary={t('gameNotificationsEmpty')} />
          </ListItem>
        )}
        {entries.map(({ kind, item: event }) =>
          kind === 'game' ? (
            <ListItem
              key={`game:${event.id}`}
              secondaryAction={
                <IconButton
                  size="small"
                  aria-label={t('gameNotificationsDeleteEntry')}
                  onClick={() =>
                    dispatch(gameNotificationsActions.delete({ key: history.key, id: event.id }))
                  }
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              }
            >
              <ListItemText primary={event.message} secondary={formatGameNotificationTime(event)} />
            </ListItem>
          ) : (
            <ListItemButton
              key={`event:${event.id}`}
              onClick={() => navigate(`/event/${event.id}`)}
              disabled={!event.id}
            >
              <ListItemText
                primary={`${devices[event.deviceId]?.name} • ${formatType(event)}`}
                secondary={formatTime(event.eventTime, 'seconds')}
              />
              <IconButton
                size="small"
                aria-label={t('gameNotificationsDeleteEntry')}
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch(eventsActions.delete(event));
                }}
              >
                <DeleteIcon fontSize="small" className={classes.delete} />
              </IconButton>
            </ListItemButton>
          ),
        )}
      </List>
    </Drawer>
  );
};

export default EventsDrawer;
