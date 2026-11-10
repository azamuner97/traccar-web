import { Fragment, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useCatch } from '../reactHelper';
import fetchOrThrow from '../common/util/fetchOrThrow';
import {
  SPEEDHUNT_PINGS,
  SPEEDHUNT_REQUESTS,
  fixedLiveMinutes,
  formatClock,
  formatCountdown,
  participantsView,
  requestGameSync,
  requestState,
  sortedRequests,
  speedhuntActions,
  timetableView,
} from './gameView';
import useGameTranslation from './useGameTranslation';
import useNow from './useNow';
import TimetableCard from './TimetableCard';
import { capitalized, requestStateColors } from './gameText';

const actionLabels = {
  speedhuntStaticPing: 'gameActionStaticPing',
  speedhuntLivePing: 'gameActionLivePing',
};

const reasonTexts = {
  paused: 'gameReasonPaused',
  caught: 'gameReasonCaught',
  open: 'gameReasonOpenParticipant',
  onBreak: 'gameReasonParticipantBreak',
};

const ParticipantRow = ({ participant, limits, actions, controls, onAction, busy }) => {
  const t = useGameTranslation();
  const { speedhunt } = participant;
  const pings = limits?.pingsPerSpeedhunt
    ? t('gamePingsOf', { count: speedhunt.pings, limit: limits.pingsPerSpeedhunt })
    : t('gamePings', { count: speedhunt.pings });
  return (
    <ListItem sx={{ display: 'block' }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
      >
        <Typography sx={{ fontWeight: 500 }}>{participant.name}</Typography>
        {participant.caught && <Chip size="small" label={t('gameParticipantOut')} />}
        {participant.break.state === 'active' && (
          <Chip
            size="small"
            color="success"
            label={t('gameParticipantProtected', {
              time: formatClock(participant.break.endsAt),
              left: formatCountdown(participant.break.remainingMs),
            })}
          />
        )}
        {participant.break.state === 'ending' && (
          <Chip size="small" label={t('gameParticipantBreakEnding')} />
        )}
        {speedhunt.running && (
          <Chip size="small" color="warning" label={`${t('gameSpeedhuntRunning')} · ${pings}`} />
        )}
        {!speedhunt.running && speedhunt.operation && (
          <Chip size="small" label={t('gameSpeedhuntOpen')} />
        )}
        {speedhunt.live && (
          <Chip
            size="small"
            color="error"
            label={
              speedhunt.liveUntil
                ? t('gameLiveUntil', { time: formatClock(speedhunt.liveUntil) })
                : t('gameLive')
            }
          />
        )}
      </Stack>
      {controls && (
        <>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1 }}>
            {SPEEDHUNT_PINGS.map((type) => (
              <Button
                key={type}
                size="small"
                variant={type === 'speedhuntStaticPing' ? 'contained' : 'outlined'}
                disabled={!actions[type] || busy}
                onClick={() => onAction(participant, type, actions.repeat)}
              >
                {t(actionLabels[type])}
              </Button>
            ))}
          </Stack>
          {actions.reason && (
            <Typography variant="caption" color="textSecondary" display="block">
              {t(reasonTexts[actions.reason])}
            </Typography>
          )}
          {actions.repeat && (
            <Typography variant="caption" color="textSecondary" display="block">
              {t('gameRepeatSpeedhunt')}
            </Typography>
          )}
        </>
      )}
    </ListItem>
  );
};

const RequestsCard = ({ requests }) => {
  const t = useGameTranslation();
  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: 0 }}>
        <Typography variant="h6">{t('gameSessionRequests')}</Typography>
      </CardContent>
      {requests.length ? (
        <List dense>
          {requests.map((request, index) => {
            const state = requestState(request);
            return (
              <Fragment key={request.id}>
                {index > 0 && <Divider component="li" />}
                <ListItem>
                  <ListItemText
                    primary={
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <span>
                          {t('gameRequestBy', {
                            action: t(`gameRequestType${capitalized(request.type)}`),
                            target: request.targetLabel || '',
                          })}
                        </span>
                        <Chip
                          size="small"
                          color={requestStateColors[state] || 'default'}
                          label={t(`gameRequestState${capitalized(state)}`)}
                        />
                      </Stack>
                    }
                    secondary={[
                      formatClock(request.createdAt, true),
                      request.requesterLabel,
                      request.message,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                </ListItem>
              </Fragment>
            );
          })}
        </List>
      ) : (
        <CardContent>
          <Typography color="textSecondary">{t('gameRequestsEmpty')}</Typography>
        </CardContent>
      )}
    </Card>
  );
};

/**
 * The hunters' game view: every player and supporter with the named speedhunt state and breaks, the
 * shared speedhunt controls, the hunter-facing timetable pings and the session's speedhunt requests.
 * Spectators see the same without controls.
 */
const HunterGameView = ({ game, controls }) => {
  const t = useGameTranslation();
  const now = useNow();
  const socket = useSelector((state) => state.session.socket);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);

  const status = game.status?.status || {};
  const controllerActive = game.status?.controllerActive === true;
  const participants = participantsView(status, game.offsetMs, now);
  const lastTarget = participants.find((item) => item.deviceId === status.lastSpeedhuntDeviceId);
  const duration = fixedLiveMinutes(status.limits);
  const requests = sortedRequests(game.requests).filter((item) =>
    SPEEDHUNT_REQUESTS.includes(item.type),
  );
  const pings = timetableView(game.timetable, {
    participants,
    offsetMs: game.offsetMs,
    now,
    controllerActive,
    connected: socket !== false,
  });

  const run = useCatch(async (body) => {
    setBusy(true);
    try {
      await fetchOrThrow('/api/game-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } finally {
      setBusy(false);
      requestGameSync();
    }
  });

  const confirm = () => {
    const { participant, type, repeat } = confirming;
    setConfirming(null);
    run({
      type,
      targetDeviceId: participant.deviceId,
      baseRevision: participant.speedhunt.revision,
      ...(repeat && { parameters: { confirmConsecutive: true } }),
    });
  };

  return (
    <>
      <Card variant="outlined">
        <CardContent sx={{ pb: 0 }}>
          <Typography variant="h6">{t('gameParticipants')}</Typography>
          {controls && (
            <>
              <Typography color="textSecondary">
                {lastTarget
                  ? t('gameLastSpeedhuntTarget', { name: lastTarget.name })
                  : t('gameNoLastSpeedhunt')}
              </Typography>
              {duration === null && (
                <Typography color="textSecondary">{t('gameLiveDurationRequired')}</Typography>
              )}
            </>
          )}
        </CardContent>
        {participants.length ? (
          <List dense>
            {participants.map((participant, index) => (
              <Fragment key={participant.deviceId}>
                {index > 0 && <Divider component="li" />}
                <ParticipantRow
                  participant={participant}
                  limits={status.limits}
                  actions={speedhuntActions(participant, {
                    requests,
                    controllerActive,
                    limits: status.limits,
                    lastSpeedhuntDeviceId: status.lastSpeedhuntDeviceId,
                  })}
                  controls={controls}
                  onAction={(item, type, repeat) =>
                    setConfirming({ participant: item, type, repeat })
                  }
                  busy={busy}
                />
              </Fragment>
            ))}
          </List>
        ) : (
          <CardContent>
            <Typography color="textSecondary">{t('gameParticipantsEmpty')}</Typography>
          </CardContent>
        )}
      </Card>
      <TimetableCard pings={pings} title={t('gameHunterPings')} showNames />
      <RequestsCard requests={requests.slice(0, 15)} />
      <Dialog open={Boolean(confirming)} onClose={() => setConfirming(null)}>
        <DialogContent>
          {confirming &&
            t(confirming.repeat ? 'gameRepeatSpeedhuntConfirm' : 'gameActionConfirm', {
              action: t(actionLabels[confirming.type]),
              name: confirming.participant.name,
            })}
          {confirming?.type === 'speedhuntLivePing' && duration !== null && (
            <Typography variant="body2" color="textSecondary">
              {t('gameLiveDuration', { minutes: duration })}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)}>{t('gameDismiss')}</Button>
          <Button variant="contained" onClick={confirm}>
            {t('gameConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default HunterGameView;
