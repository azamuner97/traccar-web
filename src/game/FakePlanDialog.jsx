import { useEffect, useRef, useState } from 'react';
import { Marker } from 'maplibre-gl';
import {
  AppBar,
  Button,
  Dialog,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import MapView, { map } from '../map/core/MapView';
import { fromMapCoordinates, toMapCoordinates } from '../map/core/mapUtil';
import {
  FAKE_USES,
  MAX_FAKE_PING_NUMBER,
  fakePingNumbers,
  fakeRequest,
  formatClock,
  validCoordinate,
} from './gameView';
import useGameTranslation from './useGameTranslation';

/** Taps on the map choose the fake's coordinate (stored in WGS84 whatever the map's style uses). */
const MapPicker = ({ coordinate, center, onPick }) => {
  useEffect(() => {
    const onClick = (event) => {
      const [longitude, latitude] = fromMapCoordinates(event.lngLat.lng, event.lngLat.lat);
      onPick({ latitude, longitude });
    };
    map.on('click', onClick);
    return () => map.off('click', onClick);
  }, [onPick]);

  // Only where the picker opens; later position updates must not move the map under the finger.
  const initialCenterRef = useRef(center);
  useEffect(() => {
    const start = initialCenterRef.current;
    if (start) {
      map.jumpTo({
        center: toMapCoordinates(start.longitude, start.latitude),
        zoom: Math.max(map.getZoom(), 15),
      });
    }
  }, []);

  useEffect(() => {
    if (!coordinate) return undefined;
    const marker = new Marker({ color: '#d32f2f' })
      .setLngLat(toMapCoordinates(coordinate.longitude, coordinate.latitude))
      .addTo(map);
    return () => marker.remove();
  }, [coordinate]);

  return null;
};

const useLabels = {
  timetable: 'gameFakeUseTimetable',
  speedhunt: 'gameFakeUseSpeedhunt',
  runningSpeedhunt: 'gameFakeUseRunning',
};

const useHints = {
  timetable: 'gameFakeTimetableHint',
  speedhunt: 'gameFakeSpeedhuntHint',
  runningSpeedhunt: 'gameFakeRunningHint',
};
const FakePlanDialog = ({
  kind: initialKind,
  uses,
  reasonText,
  pings,
  initialEntryId,
  pingsPerSpeedhunt,
  running,
  center,
  onClose,
  onSubmit,
}) => {
  const t = useGameTranslation();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('md'));
  const [coordinate, setCoordinate] = useState(null);
  const [kind, setKind] = useState(initialKind);
  const choices = pings.filter((item) => item.fakeAllowed);
  const [entryId, setEntryId] = useState(initialEntryId ?? choices[0]?.entryId ?? '');
  const numbers = fakePingNumbers(pingsPerSpeedhunt);
  const [pingNumber, setPingNumber] = useState(1);
  const [runningNumber, setRunningNumber] = useState(running?.firstPing ?? '');
  const runningNumbers = running
    ? Array.from(
        { length: running.lastPing - running.firstPing + 1 },
        (_, index) => running.firstPing + index,
      )
    : [];
  const isRunning = kind === 'runningSpeedhunt';
  const selectedRunningNumber = runningNumbers.includes(runningNumber) ? runningNumber : '';
  const selectedEntryId = choices.some((item) => item.entryId === entryId) ? entryId : '';
  const selectedPingNumber = !numbers || numbers.includes(Number(pingNumber)) ? pingNumber : '';

  const request = coordinate
    ? fakeRequest({
        kind,
        entryId: Number(selectedEntryId),
        pingNumber: Number(isRunning ? selectedRunningNumber : selectedPingNumber),
        running,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
      })
    : null;

  return (
    <Dialog open fullScreen={phone} fullWidth maxWidth="md" onClose={onClose}>
      <AppBar position="static" color="inherit" elevation={1}>
        <Toolbar>
          <IconButton edge="start" sx={{ mr: 2 }} onClick={onClose}>
            <CloseIcon />
          </IconButton>
          <Typography variant="h6">{t('gameFakeTitle')}</Typography>
        </Toolbar>
      </AppBar>
      <div
        style={{
          flexGrow: 1,
          minHeight: 320,
          height: phone ? undefined : 420,
          position: 'relative',
        }}
      >
        <MapView>
          <MapPicker coordinate={coordinate} center={center} onPick={setCoordinate} />
        </MapView>
      </div>
      <Stack spacing={2} sx={{ p: 2 }}>
        <Typography variant="body2" color={coordinate ? 'textPrimary' : 'textSecondary'}>
          {coordinate && validCoordinate(coordinate.latitude, coordinate.longitude)
            ? t('gameFakeCoordinate', {
                latitude: coordinate.latitude.toFixed(5),
                longitude: coordinate.longitude.toFixed(5),
              })
            : t('gameFakeTapMap')}
        </Typography>
        <TextField
          select
          label={t('gameFakeUse')}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          {FAKE_USES.map((use) => (
            <MenuItem
              key={use}
              value={use}
              disabled={!uses?.[use]?.enabled || (use === 'runningSpeedhunt' && !running)}
            >
              {t(useLabels[use])}
              {uses && !uses[use].enabled && reasonText ? ` (${reasonText(uses[use].reason)})` : ''}
            </MenuItem>
          ))}
        </TextField>
        {kind === 'timetable' ? (
          <TextField
            select
            label={t('gameFakeChoosePing')}
            value={selectedEntryId}
            onChange={(event) => setEntryId(event.target.value)}
            disabled={!choices.length}
            helperText={choices.length ? null : t('gameFakeNoPing')}
          >
            {choices.map((item) => (
              <MenuItem key={item.entryId} value={item.entryId}>
                {formatClock(item.scheduledAt)}
              </MenuItem>
            ))}
          </TextField>
        ) : isRunning ? (
          <TextField
            select
            label={t('gameFakeChooseRunningNumber')}
            value={selectedRunningNumber}
            disabled={!running}
            helperText={!running ? t('gameFakeRunningChanged') : null}
            onChange={(event) => setRunningNumber(event.target.value)}
          >
            {runningNumbers.map((number) => (
              <MenuItem key={number} value={number}>
                {t('gameFakePingNumber', { number })}
              </MenuItem>
            ))}
          </TextField>
        ) : numbers ? (
          <TextField
            select
            label={t('gameFakeChooseNumber')}
            value={selectedPingNumber}
            onChange={(event) => setPingNumber(event.target.value)}
          >
            {numbers.map((number) => (
              <MenuItem key={number} value={number}>
                {t('gameFakePingNumber', { number })}
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <TextField
            type="number"
            label={t('gameFakeChooseNumber')}
            value={pingNumber}
            onChange={(event) => setPingNumber(event.target.value)}
            slotProps={{ htmlInput: { min: 1, max: MAX_FAKE_PING_NUMBER, step: 1 } }}
          />
        )}
        <Typography variant="caption" color="textSecondary">
          {t(useHints[kind])}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{t('gameDismiss')}</Button>
          <Button
            variant="contained"
            disabled={!request || !uses?.[kind]?.enabled}
            onClick={() => onSubmit(request)}
          >
            {t('gameFakeSubmit')}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
};

export default FakePlanDialog;
