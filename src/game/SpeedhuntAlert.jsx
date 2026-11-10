import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Box, Typography } from '@mui/material';
import createRefreshScheduler from '../common/util/refreshScheduler';
import { speedhuntLabel } from './gameText';
import { listenGameSync } from './gameView';
import useGameTranslation from './useGameTranslation';

const SpeedhuntAlert = () => {
  const t = useGameTranslation();
  const socket = useSelector((state) => state.session.socket);
  const [speedhunt, setSpeedhunt] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const scheduler = createRefreshScheduler({
      load: async () => {
        const response = await fetch('/api/game-status/speedhunt', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (response.status === 401 || response.status === 403) return null;
        if (!response.ok) throw new Error('Could not load speedhunt status');
        const result = await response.json();
        if (typeof result?.active !== 'boolean') throw new Error('Invalid speedhunt status');
        return result.active ? result : null;
      },
      apply: setSpeedhunt,
      fail: () =>
        setSpeedhunt((current) =>
          current && !current.stale ? { ...current, stale: true } : current,
        ),
    });
    const unsubscribe = listenGameSync((resources) => {
      if (!resources || resources.includes('game-status')) scheduler.schedule();
    });
    const onVisibility = () => {
      if (!document.hidden) scheduler.schedule();
    };

    scheduler.schedule();
    const interval = setInterval(scheduler.schedule, socket ? 30000 : 5000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      scheduler.cancel();
      controller.abort();
      unsubscribe();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [socket]);

  return (
    <>
      <Box role="status" sx={{ flexShrink: 0, '@media print': { display: 'none' } }}>
        {speedhunt && (
          <Typography
            component="div"
            variant="body2"
            sx={{
              bgcolor: 'error.dark',
              color: '#fff',
              fontWeight: 700,
              textAlign: 'center',
              px: 2,
              py: 0.5,
            }}
          >
            {speedhunt.stale ? t('gameSpeedhuntStatusStale') : speedhuntLabel(t, speedhunt)}
          </Typography>
        )}
      </Box>
      {speedhunt && (
        <Box
          aria-hidden="true"
          sx={{
            position: 'fixed',
            inset: 0,
            border: '4px solid',
            borderColor: 'error.main',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            zIndex: (theme) => theme.zIndex.tooltip + 1,
            '@media print': { display: 'none' },
          }}
        />
      )}
    </>
  );
};

export default SpeedhuntAlert;
