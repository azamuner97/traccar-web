import { Fragment } from 'react';
import {
  Card,
  CardContent,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import { participantOverviewView } from './gameView';
import useGameTranslation from './useGameTranslation';

const ParticipantOverviewCard = ({ status, ownDeviceId }) => {
  const t = useGameTranslation();
  const participants = participantOverviewView(status);
  const caught = participants.filter((item) => item.caught).length;

  return (
    <Card component="section" variant="outlined" aria-labelledby="participant-overview-heading">
      <CardContent sx={{ pb: participants.length ? 0 : undefined }}>
        <Typography component="h2" variant="h6" id="participant-overview-heading">
          {t('gameParticipantOverview')}
        </Typography>
        <Typography variant="body2" color="textSecondary" aria-live="polite">
          {participants.length
            ? t('gameParticipantOverviewTotals', { inGame: participants.length - caught, caught })
            : t('gameParticipantOverviewWaiting')}
        </Typography>
      </CardContent>
      {participants.length > 0 && (
        <List dense aria-labelledby="participant-overview-heading">
          {participants.map((item, index) => {
            const role = t(
              item.role === 'player' ? 'gameParticipantPlayer' : 'gameParticipantSupporter',
            );
            return (
              <Fragment key={item.deviceId}>
                {index > 0 && <Divider component="li" />}
                <ListItem sx={{ gap: 1.5 }}>
                  <ListItemText
                    primary={item.name}
                    secondary={
                      item.deviceId === ownDeviceId ? `${role} · ${t('gameParticipantYou')}` : role
                    }
                    sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
                  />
                  <Chip
                    color={item.caught ? 'default' : 'success'}
                    variant="outlined"
                    size="small"
                    label={t(item.caught ? 'gameParticipantCaught' : 'gameParticipantInGame')}
                    sx={{ flexShrink: 0 }}
                  />
                </ListItem>
              </Fragment>
            );
          })}
        </List>
      )}
    </Card>
  );
};

export default ParticipantOverviewCard;
