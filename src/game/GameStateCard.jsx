import { Alert, Button, Stack, Typography } from '@mui/material';
import { connectionState, formatClock, requestGameSync } from './gameView';
import { speedhuntLabel } from './gameText';
import SpeedhuntPingHistory from './SpeedhuntPingHistory';
import useGameTranslation from './useGameTranslation';

const severities = {
  running: 'success',
  paused: 'warning',
  disconnected: 'error',
  loading: 'info',
  error: 'error',
};

const texts = {
  running: 'gameStateRunning',
  paused: 'gameStatePaused',
  disconnected: 'gameStateDisconnected',
  loading: 'gameStateLoading',
  error: 'gameStateError',
};

/** Whether the game runs (a Tool controls it), and whether this page is connected and current. */
const GameStateCard = ({ game, socket, showSpeedhunt }) => {
  const t = useGameTranslation();
  const error = game.statusError || game.error;
  const state = connectionState({
    socket,
    loaded: game.loaded,
    error,
    controllerActive: game.status?.controllerActive,
  });
  const speedhunt = game.status?.status?.speedhunt;
  return (
    <Stack spacing={1}>
      <Alert
        severity={severities[state]}
        action={
          state === 'error' ? (
            <Button color="inherit" size="small" onClick={() => requestGameSync()}>
              {t('gameRetry')}
            </Button>
          ) : null
        }
      >
        {t(texts[state])}
      </Alert>
      {game.loaded && error && state !== 'disconnected' && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => requestGameSync()}>
              {t('gameRetry')}
            </Button>
          }
        >
          {t('gameRefreshFailed')}
        </Alert>
      )}
      {showSpeedhunt && game.loaded && (
        <Alert severity={speedhunt?.active ? 'error' : 'info'} variant="outlined">
          {speedhunt?.active ? speedhuntLabel(t, speedhunt) : t('gameSpeedhuntInactive')}
          {speedhunt?.active && <SpeedhuntPingHistory pings={speedhunt.pingHistory} />}
        </Alert>
      )}
      {game.refreshedAt && (
        <Typography variant="caption" color="textSecondary">
          {t('gameUpdatedAt', {
            time: formatClock(new Date(game.refreshedAt).toISOString(), true),
          })}
        </Typography>
      )}
    </Stack>
  );
};

export default GameStateCard;
