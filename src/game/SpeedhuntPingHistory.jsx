import { Box, Typography } from '@mui/material';
import { formatClock } from './gameView';
import useGameTranslation from './useGameTranslation';

const SpeedhuntPingHistory = ({ pings }) => {
  const t = useGameTranslation();
  if (!Array.isArray(pings) || !pings.length) return null;

  return (
    <Box component="ul" sx={{ m: 0, mt: 0.5, paddingInlineStart: 2.5 }}>
      {pings.map(({ number, sentAt }) => (
        <Typography component="li" variant="body2" key={number}>
          {t('gameSpeedhuntPingAt', { number, time: formatClock(sentAt, true) })}
        </Typography>
      ))}
    </Box>
  );
};

export default SpeedhuntPingHistory;
