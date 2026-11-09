import { Fragment } from 'react';
import {
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { formatClock, formatCountdown } from './gameView';
import useGameTranslation from './useGameTranslation';
import { capitalized, pingStateColors } from './gameText';

// The recent past is kept short; upcoming pings come first in time order.
const PAST_SHOWN = 5;
const UPCOMING_SHOWN = 20;

/** Timetable pings with their state: the recent past and what comes next, with a countdown to the next. */
const TimetableCard = ({ pings, title, showNames, planned = new Set(), onPlan }) => {
  const t = useGameTranslation();
  const past = pings.filter((item) => !item.upcoming).slice(-PAST_SHOWN);
  const upcoming = pings.filter((item) => item.upcoming).slice(0, UPCOMING_SHOWN);
  const shown = [...past, ...upcoming];
  const next = upcoming[0];
  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: 0 }}>
        <Typography variant="h6">{title}</Typography>
        {next && (
          <Typography variant="body2" color="textSecondary">
            {t('gameNextPing', {
              time: formatClock(next.scheduledAt),
              left: formatCountdown(next.remainingMs),
            })}
          </Typography>
        )}
      </CardContent>
      {shown.length ? (
        <List dense>
          {shown.map((ping, index) => (
            <Fragment key={ping.entryId}>
              {index > 0 && <Divider component="li" />}
              <ListItem
                sx={{ opacity: ping.upcoming ? 1 : 0.7 }}
                secondaryAction={
                  onPlan && ping.fakeAllowed && !planned.has(ping.entryId) ? (
                    <Button size="small" onClick={() => onPlan(ping)}>
                      {t('gameFakePlan')}
                    </Button>
                  ) : null
                }
              >
                <ListItemText
                  primary={
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <span>
                        {formatClock(ping.scheduledAt)}
                        {showNames && ping.name ? ` · ${ping.name}` : ''}
                      </span>
                      <Chip
                        size="small"
                        color={pingStateColors[ping.state] || 'default'}
                        label={t(`gamePingState${capitalized(ping.state)}`)}
                      />
                      {planned.has(ping.entryId) && (
                        <Chip size="small" variant="outlined" label={t('gameFakePlanned')} />
                      )}
                    </Stack>
                  }
                  sx={onPlan && ping.fakeAllowed ? { pr: 10 } : undefined}
                />
              </ListItem>
            </Fragment>
          ))}
        </List>
      ) : (
        <CardContent>
          <Typography color="textSecondary">{t('gamePingsEmpty')}</Typography>
        </CardContent>
      )}
    </Card>
  );
};

export default TimetableCard;
