import { useSelector } from 'react-redux';
import { Alert, Box, Typography } from '@mui/material';
import { activeHunterLiveShares } from './gameView';
import { liveShareReason } from './gameText';
import useGameTranslation from './useGameTranslation';
import useNow from './useNow';

const LiveShareInfo = () => {
  const t = useGameTranslation();
  const user = useSelector((state) => state.session.user);
  const game = useSelector((state) => state.game);
  const now = useNow();
  const shares = activeHunterLiveShares(game, user, now);
  if (!shares.length) return null;

  return (
    <Alert
      role="status"
      severity="warning"
      variant="outlined"
      sx={{
        borderColor: 'warning.main',
        borderWidth: 2,
        '& .MuiAlert-message': { flex: 1, minWidth: 0 },
        '@media print': { display: 'none' },
      }}
    >
      <Typography variant="subtitle2">{t('gameLiveShareTitle')}</Typography>
      <Box
        component="ul"
        sx={{
          m: 0,
          pl: 2,
          maxHeight: '25vh',
          overflowY: 'auto',
          overflowWrap: 'anywhere',
          '& li + li': { mt: 0.5 },
        }}
      >
        {shares.map((share) => (
          <li key={share.deviceId}>
            {share.name}
            <Typography component="span" variant="body2">
              {' · '}
              <strong>{t('gameLiveShareReason')}</strong> {liveShareReason(t, share)}
            </Typography>
          </li>
        ))}
      </Box>
    </Alert>
  );
};

export default LiveShareInfo;
