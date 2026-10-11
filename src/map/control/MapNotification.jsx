import { useEffect, useRef } from 'react';
import { useTheme } from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import { createRoot } from 'react-dom/client';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { map } from '../core/MapView';
import { useTranslation } from '../../common/components/LocalizationProvider';

const useStyles = makeStyles()((theme) => ({
  button: {
    '&&': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#333',
    },
    '&&.active': {
      color: theme.palette.error.main,
    },
  },
}));

const MapNotification = ({ enabled, onClick, unreadCount = 0 }) => {
  const theme = useTheme();
  const { classes } = useStyles();
  const t = useTranslation();

  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  const buttonRef = useRef(null);

  useEffect(() => {
    let container;
    let root;
    const control = {
      onAdd: () => {
        container = document.createElement('div');
        container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `maplibregl-ctrl-icon ${classes.button}`;
        button.onclick = () => onClickRef.current();
        container.appendChild(button);
        root = createRoot(button);
        root.render(<NotificationsIcon fontSize="small" />);
        buttonRef.current = button;
        return container;
      },
      onRemove: () => {
        queueMicrotask(() => root.unmount());
        container.remove();
      },
    };
    map.addControl(control, theme.direction === 'rtl' ? 'top-left' : 'top-right');
    return () => map.removeControl(control);
  }, [theme.direction, classes.button]);

  useEffect(() => {
    buttonRef.current?.classList.toggle('active', enabled);
    const label =
      unreadCount > 0
        ? `${t('reportEvents')}, ${t('gameNotificationsUnread')}: ${unreadCount}`
        : t('reportEvents');
    buttonRef.current?.setAttribute('aria-label', label);
    buttonRef.current?.setAttribute('title', label);
  }, [enabled, unreadCount, t, classes.button, theme.direction]);

  return null;
};

export default MapNotification;
