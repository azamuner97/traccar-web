import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Box, Typography } from '@mui/material';
import createRefreshScheduler from '../common/util/refreshScheduler';
import { listenGameSync } from './gameView';
import useGameTranslation from './useGameTranslation';

const SpeedhuntAlert = () => {
  const t = useGameTranslation();
  const socket = useSelector((state) => state.session.socket);
  const [status, setStatus] = useState('inactive');

  useEffect(() => {
    const controller = new AbortController();
    const scheduler = createRefreshScheduler({
      load: async () => {
        const response = await fetch('/api/game-status/speedhunt', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (response.status === 401 || response.status === 403) return 'inactive';
        if (!response.ok) throw new Error('Could not load speedhunt status');
        const result = await response.json();
        if (typeof result?.active !== 'boolean') throw new Error('Invalid speedhunt status');
        return result.active ? 'active' : 'inactive';
      },
      apply: setStatus,
      fail: () => setStatus((current) => (current === 'active' ? 'stale' : current)),
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

  const visible = status !== 'inactive';
  return (
    <>
      <Box role="status" sx={{ flexShrink: 0, '@media print': { display: 'none' } }}>
        {visible && (
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
            {t(status === 'stale' ? 'gameSpeedhuntStatusStale' : 'gameSpeedhuntActive')}
          </Typography>
        )}
      </Box>
      {visible && (
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
