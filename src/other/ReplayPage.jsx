import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Paper,
  Slider,
  Switch,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import TuneIcon from '@mui/icons-material/Tune';
import DownloadIcon from '@mui/icons-material/Download';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import MapView, { map } from '../map/core/MapView';
import MapRoutePath from '../map/MapRoutePath';
import MapRoutePoints from '../map/MapRoutePoints';
import MapPositionMarkers from '../map/MapPositionMarkers';
import { formatTime } from '../common/util/formatter';
import ReportFilter from '../reports/components/ReportFilter';
import { useTranslation } from '../common/components/LocalizationProvider';
import { useCatchCallback } from '../reactHelper';
import MapCamera from '../map/MapCamera';
import MapGeofence from '../map/MapGeofence';
import StatusCard from '../common/components/StatusCard';
import MapScale from '../map/MapScale';
import BackIcon from '../common/components/BackIcon';
import fetchOrThrow from '../common/util/fetchOrThrow';
import MapOverlay from '../map/overlay/MapOverlay';
import { deviceEquality } from '../common/util/deviceEquality';
import {
  MAX_REPLAY_RANGE,
  REPLAY_SPEEDS,
  advanceReplayTime,
  buildReplayQuery,
  buildReplayTracks,
  clampReplayTime,
  clearReplayPeriod,
  getReplaySnapshot,
  parseReplaySpeed,
  resolveReplayDeviceIds,
  validateReplayDeviceIds,
  validateReplayRange,
} from './replayUtils';

const useStyles = makeStyles()((theme) => ({
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  map: {
    position: 'relative',
    flex: '1 1 auto',
    minHeight: 0,
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    position: 'absolute',
    zIndex: 3,
    left: 0,
    top: 0,
    margin: theme.spacing(1.5),
    width: theme.dimensions.drawerWidthDesktop,
    [theme.breakpoints.down('md')]: {
      width: '100%',
      margin: 0,
    },
  },
  title: {
    flexGrow: 1,
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    padding: theme.spacing(2),
    [theme.breakpoints.down('md')]: {
      margin: theme.spacing(1),
    },
    [theme.breakpoints.up('md')]: {
      marginTop: theme.spacing(1),
    },
  },
  playback: {
    position: 'relative',
    zIndex: 3,
    flex: '0 0 auto',
    padding: theme.spacing(1.5, 2, 1.25),
  },
  timeline: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
  },
  timelineLabel: {
    flex: '0 0 auto',
    minWidth: '5.5rem',
    fontVariantNumeric: 'tabular-nums',
    [theme.breakpoints.down('sm')]: {
      minWidth: 'auto',
    },
  },
  slider: {
    flexGrow: 1,
    minWidth: theme.spacing(12),
  },
  currentTimestamp: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing(2),
    marginTop: theme.spacing(-0.5),
    fontVariantNumeric: 'tabular-nums',
  },
  currentDate: {
    textAlign: 'right',
  },
  currentClock: {
    textAlign: 'left',
  },
  transport: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginTop: theme.spacing(0.5),
  },
  speed: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(1),
  },
  speedLabel: {
    marginRight: theme.spacing(0.5),
  },
  speedButton: {
    minWidth: theme.spacing(5.5),
  },
  manualSpeed: {
    width: theme.spacing(14),
    marginLeft: theme.spacing(0.5),
  },
}));

const ReplayPage = () => {
  const t = useTranslation();
  const { classes } = useStyles();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const devices = useSelector(
    (state) => state.devices.items,
    deviceEquality(['id', 'groupId', 'name']),
  );
  const groups = useSelector((state) => state.groups.items);

  const [positions, setPositions] = useState([]);
  const [tracks, setTracks] = useState(() => new Map());
  const [loadedDeviceIds, setLoadedDeviceIds] = useState([]);
  const [fromTime, setFromTime] = useState(0);
  const [toTime, setToTime] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [speedInput, setSpeedInput] = useState('1');
  const [showRoutes, setShowRoutes] = useState(false);
  const [showRoutePoints, setShowRoutePoints] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cardDeviceId, setCardDeviceId] = useState(null);
  const [playbackHeight, setPlaybackHeight] = useState(0);

  const currentTimeRef = useRef(0);
  const speedRef = useRef(1);
  const requestRef = useRef(0);
  const playbackRef = useRef(null);

  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const loaded = Boolean(from && to && !loading && positions.length && tracks.size);

  const visiblePositions = useMemo(
    () => getReplaySnapshot(tracks, currentTime),
    [tracks, currentTime],
  );
  const cardPosition = useMemo(
    () => visiblePositions.find((position) => position.deviceId === cardDeviceId),
    [visiblePositions, cardDeviceId],
  );
  const routeSpeedRange = useMemo(() => {
    let minSpeed = Infinity;
    let maxSpeed = -Infinity;
    positions.forEach((position) => {
      const value = Number(position.speed);
      if (Number.isFinite(value)) {
        minSpeed = Math.min(minSpeed, value);
        maxSpeed = Math.max(maxSpeed, value);
      }
    });
    return { minSpeed, maxSpeed };
  }, [positions]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    if (!from || !to) {
      requestRef.current += 1;
      currentTimeRef.current = 0;
      setPositions([]);
      setTracks(new Map());
      setLoadedDeviceIds([]);
      setCurrentTime(0);
      setPlaying(false);
      setCardDeviceId(null);
      setShowRoutePoints(false);
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    if (!playing) {
      return undefined;
    }

    let animationFrame;
    let previousFrame = performance.now();
    let previousUpdate = previousFrame;
    const update = (frameTime) => {
      const nextTime = advanceReplayTime(
        currentTimeRef.current,
        frameTime - previousFrame,
        speedRef.current,
        toTime,
      );
      previousFrame = frameTime;
      currentTimeRef.current = nextTime;

      if (frameTime - previousUpdate >= 100 || nextTime >= toTime) {
        setCurrentTime(nextTime);
        previousUpdate = frameTime;
      }
      if (nextTime >= toTime) {
        setPlaying(false);
      } else {
        animationFrame = requestAnimationFrame(update);
      }
    };

    animationFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrame);
  }, [playing, toTime]);

  useLayoutEffect(() => {
    const element = loaded ? playbackRef.current : null;
    const updateLayout = () => {
      const nextHeight = element?.offsetHeight || 0;
      setPlaybackHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight,
      );
      map.resize();
    };
    updateLayout();

    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(updateLayout);
    observer.observe(element);
    return () => observer.disconnect();
  }, [loaded]);

  useEffect(() => {
    if (cardDeviceId && !cardPosition) {
      setCardDeviceId(null);
    }
  }, [cardDeviceId, cardPosition]);

  const onMarkerClick = useCallback((_, deviceId) => setCardDeviceId(deviceId), []);

  const onShow = useCatchCallback(
    async ({ deviceIds, groupIds, from, to }) => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      setPlaying(false);
      setLoading(true);
      setPositions([]);
      setTracks(new Map());
      setLoadedDeviceIds([]);
      setCardDeviceId(null);
      setShowRoutePoints(false);

      try {
        const range = validateReplayRange(from, to);
        const resolvedDeviceIds = validateReplayDeviceIds(
          resolveReplayDeviceIds(devices, groups, deviceIds, groupIds),
        );
        const query = buildReplayQuery(resolvedDeviceIds, from, to);
        const response = await fetchOrThrow(`/api/reports/route?${query.toString()}`, {
          headers: { Accept: 'application/json' },
        });
        const result = await response.json();
        if (requestRef.current !== requestId) {
          return;
        }

        const nextTracks = buildReplayTracks(
          result,
          range.fromTime,
          range.toTime,
          resolvedDeviceIds,
        );
        const nextPositions = [...nextTracks.values()].flat();
        if (!nextPositions.length) {
          throw Error(t('sharedNoData'));
        }

        currentTimeRef.current = range.fromTime;
        speedRef.current = 1;
        setFromTime(range.fromTime);
        setToTime(range.toTime);
        setCurrentTime(range.fromTime);
        setSpeed(1);
        setSpeedInput('1');
        setTracks(nextTracks);
        setPositions(nextPositions);
        setLoadedDeviceIds(resolvedDeviceIds);
      } catch (error) {
        if (requestRef.current === requestId) {
          throw error;
        }
      } finally {
        if (requestRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [devices, groups, t],
  );

  const seekTo = useCallback(
    (value) => {
      const nextTime = clampReplayTime(Number(value), fromTime, toTime);
      currentTimeRef.current = nextTime;
      setCurrentTime(nextTime);
      setPlaying(false);
    },
    [fromTime, toTime],
  );

  const onRoutePointClick = useCallback(
    (positionId) => {
      const position = positions.find((item) => item.id === positionId);
      if (position) {
        setCardDeviceId(null);
        seekTo(position._replayTime);
      }
    },
    [positions, seekTo],
  );

  const seekBy = (seconds) => seekTo(currentTimeRef.current + seconds * 1000);

  const togglePlaying = () => {
    if (playing) {
      setCurrentTime(currentTimeRef.current);
      setPlaying(false);
    } else if (currentTimeRef.current < toTime) {
      setPlaying(true);
    }
  };

  const changeSpeed = (nextSpeed) => {
    speedRef.current = nextSpeed;
    setSpeed(nextSpeed);
    setSpeedInput(String(nextSpeed));
  };

  const changeManualSpeed = (value) => {
    setSpeedInput(value);
    const nextSpeed = parseReplaySpeed(value);
    if (nextSpeed !== null) {
      speedRef.current = nextSpeed;
      setSpeed(nextSpeed);
    }
  };

  const resetManualSpeed = () => {
    if (parseReplaySpeed(speedInput) === null) {
      setSpeedInput(String(speedRef.current));
    }
  };

  const openFilter = () => {
    setPlaying(false);
    setShowRoutePoints(false);
    setSearchParams(clearReplayPeriod(searchParams), { replace: true });
  };

  const changeShowRoutes = (checked) => {
    setShowRoutes(checked);
    if (!checked) {
      setShowRoutePoints(false);
    }
  };

  const handleDownload = () => {
    const query = new URLSearchParams({ deviceId: loadedDeviceIds[0], from, to });
    window.location.assign(`/api/positions/kml?${query.toString()}`);
  };

  const secondLabel = t('sharedSecondAbbreviation');

  return (
    <div className={classes.root}>
      <div className={classes.map}>
        <MapView>
          <MapOverlay />
          <MapGeofence />
          {showRoutes &&
            [...tracks.entries()].map(([deviceId, track]) => (
              <MapRoutePath key={deviceId} positions={track} {...routeSpeedRange} continuousLine />
            ))}
          {showRoutes && (
            <MapRoutePoints
              positions={positions}
              onClick={onRoutePointClick}
              showPoints={showRoutePoints}
              showSpeedControl
            />
          )}
          <MapPositionMarkers
            positions={visiblePositions}
            onMarkerClick={onMarkerClick}
            disableClustering
          />
        </MapView>
        <MapScale />
        <MapCamera positions={positions} />
        <div className={classes.sidebar}>
          <Paper elevation={3} square>
            <Toolbar>
              <IconButton edge="start" sx={{ mr: 2 }} onClick={() => navigate(-1)}>
                <BackIcon />
              </IconButton>
              <Typography variant="h6" className={classes.title}>
                {t('reportReplay')}
              </Typography>
              {loaded && loadedDeviceIds.length === 1 && (
                <IconButton onClick={handleDownload}>
                  <DownloadIcon />
                </IconButton>
              )}
              {loaded && (
                <IconButton edge="end" onClick={openFilter}>
                  <TuneIcon />
                </IconButton>
              )}
            </Toolbar>
          </Paper>
          {!loaded && (
            <Paper className={classes.content} square>
              <ReportFilter
                onShow={onShow}
                deviceType="multiple"
                loading={loading}
                periodLimit={MAX_REPLAY_RANGE}
              />
            </Paper>
          )}
        </div>
      </div>
      {loaded && (
        <Paper ref={playbackRef} className={classes.playback} square elevation={4}>
          <div className={classes.timeline}>
            <Typography className={classes.timelineLabel} variant="body2">
              {formatTime(fromTime, 'time')}
            </Typography>
            <Slider
              className={classes.slider}
              min={fromTime}
              max={toTime}
              step={1000}
              value={currentTime}
              onChange={(_, value) => seekTo(value)}
            />
            <Typography className={classes.timelineLabel} variant="body2" align="right">
              {formatTime(toTime, 'time')}
            </Typography>
          </div>
          <div className={classes.currentTimestamp}>
            <Typography className={classes.currentDate} variant="subtitle1">
              {formatTime(currentTime, 'date')}
            </Typography>
            <Typography className={classes.currentClock} variant="subtitle1">
              {formatTime(currentTime, 'time')}
            </Typography>
          </div>
          <div className={classes.transport}>
            <Button
              size="small"
              variant="outlined"
              disabled={currentTime <= fromTime}
              onClick={() => seekBy(-10)}
            >
              − 10{secondLabel}
            </Button>
            <Button
              size="small"
              variant="outlined"
              disabled={currentTime <= fromTime}
              onClick={() => seekBy(-1)}
            >
              − 1{secondLabel}
            </Button>
            <IconButton
              color="primary"
              disabled={!playing && currentTime >= toTime}
              onClick={togglePlaying}
              aria-label={t('reportReplay')}
            >
              {playing ? <PauseIcon /> : <PlayArrowIcon />}
            </IconButton>
            <Button
              size="small"
              variant="outlined"
              disabled={currentTime >= toTime}
              onClick={() => seekBy(1)}
            >
              1{secondLabel} +
            </Button>
            <Button
              size="small"
              variant="outlined"
              disabled={currentTime >= toTime}
              onClick={() => seekBy(10)}
            >
              10{secondLabel} +
            </Button>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={showRoutes}
                  onChange={(event) => changeShowRoutes(event.target.checked)}
                />
              }
              label={t('mapLiveRoutes')}
            />
            {showRoutes && (
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={showRoutePoints}
                    onChange={(event) => setShowRoutePoints(event.target.checked)}
                  />
                }
                label={t('reportShowMarkers')}
              />
            )}
          </div>
          <div className={classes.speed}>
            <Typography className={classes.speedLabel} variant="body2">
              {t('positionSpeed')}:
            </Typography>
            {REPLAY_SPEEDS.map((value) => (
              <Button
                key={value}
                className={classes.speedButton}
                size="small"
                variant={speed === value ? 'contained' : 'text'}
                aria-pressed={speed === value}
                onClick={() => changeSpeed(value)}
              >
                {value}×
              </Button>
            ))}
            <TextField
              className={classes.manualSpeed}
              type="number"
              size="small"
              label={t('reportCustom')}
              value={speedInput}
              error={parseReplaySpeed(speedInput) === null}
              onChange={(event) => changeManualSpeed(event.target.value)}
              onBlur={resetManualSpeed}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
              slotProps={{
                htmlInput: {
                  step: 'any',
                  inputMode: 'decimal',
                  'aria-label': t('reportCustom'),
                },
                input: {
                  endAdornment: <InputAdornment position="end">×</InputAdornment>,
                },
              }}
            />
          </div>
        </Paper>
      )}
      {cardPosition && (
        <StatusCard
          deviceId={cardDeviceId}
          position={cardPosition}
          onClose={() => setCardDeviceId(null)}
          disableActions
          bottomOffset={playbackHeight}
        />
      )}
    </div>
  );
};

export default ReplayPage;
