import { useCallback, useEffect, useState } from 'react';
import { ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useDispatch } from 'react-redux';
import { map } from '../core/MapView';
import { fromMapCoordinates } from '../core/mapUtil';
import { copyText, createLongPressController, formatCoordinates } from '../coordinateSelection';
import { errorsActions } from '../../store';
import { useTranslation } from '../../common/components/LocalizationProvider';

const MapCoordinates = () => {
  const dispatch = useDispatch();
  const t = useTranslation();
  const [selection, setSelection] = useState(null);

  const openMenu = useCallback(({ longitude, latitude, clientX, clientY }) => {
    const [normalizedLongitude, normalizedLatitude] = fromMapCoordinates(longitude, latitude);
    setSelection({
      anchorPosition: { left: clientX, top: clientY },
      coordinates: formatCoordinates(normalizedLatitude, normalizedLongitude),
    });
  }, []);

  useEffect(() => {
    const touchValue = (event) => {
      const touch = event.originalEvent.touches[0];
      return touch
        ? {
            longitude: event.lngLat.lng,
            latitude: event.lngLat.lat,
            clientX: touch.clientX,
            clientY: touch.clientY,
          }
        : undefined;
    };

    const longPress = createLongPressController({ onLongPress: openMenu });

    const onContextMenu = (event) => {
      openMenu({
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
        clientX: event.originalEvent.clientX,
        clientY: event.originalEvent.clientY,
      });
    };
    const onTouchStart = (event) => {
      const value = touchValue(event);
      if (value) {
        longPress.start(event.points, value);
      } else {
        longPress.cancel();
      }
    };
    const onTouchMove = (event) => {
      const value = touchValue(event);
      if (value) {
        longPress.move(event.points, value);
      } else {
        longPress.cancel();
      }
    };
    const onCanvasClick = (event) => {
      if (longPress.consumeSuppressedClick()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const closeMenu = () => setSelection(null);
    const canvas = map.getCanvas();

    map.on('contextmenu', onContextMenu);
    map.on('touchstart', onTouchStart);
    map.on('touchmove', onTouchMove);
    map.on('touchend', longPress.end);
    map.on('touchcancel', longPress.cancel);
    map.on('movestart', closeMenu);
    canvas.addEventListener('click', onCanvasClick, true);

    return () => {
      longPress.dispose();
      map.off('contextmenu', onContextMenu);
      map.off('touchstart', onTouchStart);
      map.off('touchmove', onTouchMove);
      map.off('touchend', longPress.end);
      map.off('touchcancel', longPress.cancel);
      map.off('movestart', closeMenu);
      canvas.removeEventListener('click', onCanvasClick, true);
    };
  }, [openMenu]);

  const copyCoordinates = async () => {
    try {
      await copyText(selection.coordinates);
      setSelection(null);
    } catch (error) {
      dispatch(
        errorsActions.push(
          error instanceof Error && error.message ? error.message : t('sharedCopy'),
        ),
      );
    }
  };

  return (
    <Menu
      anchorReference="anchorPosition"
      anchorPosition={selection?.anchorPosition}
      open={Boolean(selection)}
      onClose={() => setSelection(null)}
    >
      <MenuItem
        onClick={copyCoordinates}
        aria-label={selection ? `${t('sharedCopy')}: ${selection.coordinates}` : t('sharedCopy')}
      >
        <ListItemIcon>
          <ContentCopyIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary={selection?.coordinates} />
      </MenuItem>
    </Menu>
  );
};

export default MapCoordinates;
