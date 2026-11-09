import { Fragment, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  Button,
  Card,
  CardActions,
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
  JOKER_REQUESTS,
  JOKER_TYPES,
  breakView,
  canCancelRequest,
  formatClock,
  formatCountdown,
  inventoryByType,
  isOpenRequest,
  jokerAvailability,
  plannedBreaksView,
  remainingMs,
  requestGameSync,
  requestState,
  reservationsView,
  serverNow,
  sortedRequests,
  timetableView,
} from './gameView';
import useGameTranslation from './useGameTranslation';
import useNow from './useNow';
import TimetableCard from './TimetableCard';
import FakePlanDialog from './FakePlanDialog';
import BreakPlanDialog from './BreakPlanDialog';
import { capitalized, requestStateColors } from './gameText';

const jokerLabels = {
  hunterPositions: 'gameJokerHunterPositions',
  break: 'gameJokerBreak',
  fakePing: 'gameJokerFakePing',
};

const reasonTexts = {
  paused: 'gameReasonPaused',
  open: 'gameReasonOpen',
  none: 'gameReasonNone',
  onBreak: 'gameReasonOnBreak',
  speedhunt: 'gameReasonSpeedhunt',
  noPing: 'gameReasonNoPing',
  planned: 'gameReasonPlanned',
  noFakeUse: 'gameReasonNoFakeUse',
};

// Jokers used from the Jokers card: used at once (after a confirmation) or planned on the map.
const actionLabels = {
  hunterPositions: 'gameJokerUse',
  fakePing: 'gameFakePlan',
};

const coordinate = (item) =>
  item.latitude !== null && item.longitude !== null
    ? `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}`
    : null;

const post = (url, body) =>
  fetchOrThrow(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

const BreakCard = ({ status, offsetMs, now, availability, planned, onUse, onCancel, busy }) => {
  const t = useGameTranslation();
  const view = breakView(status?.break, offsetMs, now);
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t('gameBreak')}
        </Typography>
        {view.state === 'active' && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography>{t('gameBreakActive', { time: formatClock(view.endsAt) })}</Typography>
            {view.remainingMs !== null && (
              <Chip
                color="success"
                size="small"
                label={t('gameBreakRemaining', { time: formatCountdown(view.remainingMs) })}
              />
            )}
          </Stack>
        )}
        {view.state === 'ending' && (
          <Typography>{t('gameBreakEnding', { time: formatClock(view.endsAt) })}</Typography>
        )}
        {view.state === 'none' && <Typography>{t('gameBreakNone')}</Typography>}
        {planned.length > 0 && (
          <List dense disablePadding>
            {planned.map((item) => (
              <ListItem
                key={item.id}
                disableGutters
                secondaryAction={
                  item.cancellable ? (
                    <Button size="small" disabled={busy} onClick={() => onCancel(item.id)}>
                      {t('gameCancel')}
                    </Button>
                  ) : null
                }
              >
                <ListItemText
                  primary={
                    item.due
                      ? t('gameBreakPlannedDue')
                      : t('gameBreakPlanned', { time: formatClock(item.startsAt) })
                  }
                  secondary={
                    [
                      item.kind === 'held' ? t('gameRequestStateAwaitingApproval') : null,
                      !item.due && item.remainingMs !== null
                        ? t('gameBreakStartsIn', { time: formatCountdown(item.remainingMs) })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || null
                  }
                  sx={item.cancellable ? { pr: 10 } : undefined}
                />
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>
      <CardActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button
          variant="contained"
          disabled={!availability.enabled || busy}
          onClick={() => onUse('break')}
        >
          {t('gameBreakTakeOrPlan')}
        </Button>
        {!availability.enabled && (
          <Typography variant="caption" color="textSecondary">
            {t(reasonTexts[availability.reason])}
          </Typography>
        )}
      </CardActions>
    </Card>
  );
};

const JokersCard = ({ inventory, availability, onUse, busy }) => {
  const t = useGameTranslation();
  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: 0 }}>
        <Typography variant="h6">{t('gameJokers')}</Typography>
      </CardContent>
      <List dense>
        {JOKER_TYPES.map((type) => {
          const item = inventory[type];
          const usable = Boolean(actionLabels[type]);
          const secondary = [
            t('gameJokerCounts', {
              available: item.available,
              reserved: item.reserved,
              used: item.used,
            }),
            item.overAllocated ? t('gameJokerOver', { count: item.overAllocated }) : null,
            usable && !availability[type].enabled
              ? t(reasonTexts[availability[type].reason])
              : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <ListItem
              key={type}
              secondaryAction={
                usable ? (
                  <Button
                    size="small"
                    variant="contained"
                    disabled={!availability[type].enabled || busy}
                    onClick={() => onUse(type)}
                  >
                    {t(actionLabels[type])}
                  </Button>
                ) : null
              }
            >
              <ListItemText
                primary={t(jokerLabels[type])}
                secondary={secondary}
                sx={usable ? { pr: 10 } : undefined}
              />
            </ListItem>
          );
        })}
      </List>
    </Card>
  );
};

const reservationText = (t, item) => {
  if (item.kind === 'held') {
    return t('gameReservationHeld', { joker: t(jokerLabels[item.type]), id: item.requestId });
  }
  if (item.kind === 'bound') {
    return t('gameReservationBound', { time: formatClock(item.boundAt), number: item.pingNumber });
  }
  if (item.type === 'break') {
    return t('gameReservationArmedBreak', { time: formatClock(item.startsAt) });
  }
  if (item.use === 'timetable') {
    return t('gameReservationArmedTimetable', { time: formatClock(item.scheduledAt) });
  }
  return t('gameReservationArmedSpeedhunt', { number: item.pingNumber });
};

const reservationStates = {
  held: ['gameReservationHeldState', 'default'],
  armed: ['gameReservationArmed', 'info'],
  bound: ['gameReservationUsed', 'success'],
};

const ReservationsCard = ({ reservations, onCancel, busy }) => {
  const t = useGameTranslation();
  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: 0 }}>
        <Typography variant="h6">{t('gameReservations')}</Typography>
      </CardContent>
      {reservations.length ? (
        <List dense>
          {reservations.map((item) => {
            const [label, color] = reservationStates[item.kind];
            return (
              <ListItem
                key={item.id}
                secondaryAction={
                  item.cancellable ? (
                    <Button size="small" disabled={busy} onClick={() => onCancel(item.id)}>
                      {t('gameCancel')}
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
                      <span>{reservationText(t, item)}</span>
                      <Chip size="small" color={color} label={t(label)} />
                    </Stack>
                  }
                  secondary={coordinate(item)}
                  sx={item.cancellable ? { pr: 10 } : undefined}
                />
              </ListItem>
            );
          })}
        </List>
      ) : (
        <CardContent>
          <Typography color="textSecondary">{t('gameReservationsEmpty')}</Typography>
        </CardContent>
      )}
    </Card>
  );
};

const RequestsCard = ({ requests, userId, offsetMs, now, onCancel, busy }) => {
  const t = useGameTranslation();
  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: 0 }}>
        <Typography variant="h6">{t('gameRequests')}</Typography>
      </CardContent>
      {requests.length ? (
        <List dense>
          {requests.map((request, index) => {
            const state = requestState(request);
            const left = isOpenRequest(request)
              ? remainingMs(request.expiresAt, offsetMs, now)
              : null;
            const details = [
              formatClock(request.createdAt, true),
              request.message,
              left !== null ? t('gameRequestExpires', { time: formatCountdown(left) }) : null,
            ]
              .filter(Boolean)
              .join(' · ');
            const cancellable = canCancelRequest(request, userId);
            return (
              <Fragment key={request.id}>
                {index > 0 && <Divider component="li" />}
                <ListItem
                  secondaryAction={
                    cancellable ? (
                      <Button size="small" disabled={busy} onClick={() => onCancel(request.id)}>
                        {t('gameCancel')}
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
                        <span>{t(`gameRequestType${capitalized(request.type)}`)}</span>
                        <Chip
                          size="small"
                          color={requestStateColors[state] || 'default'}
                          label={t(`gameRequestState${capitalized(state)}`)}
                        />
                      </Stack>
                    }
                    secondary={details}
                    sx={cancellable ? { pr: 10 } : undefined}
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
 * A player's or supporter's own game: break, jokers, own timetable pings, reservations and plans
 * (fakes are planned on a map), and requests.
 */
const ParticipantGameView = ({ game, user }) => {
  const t = useGameTranslation();
  const now = useNow();
  const socket = useSelector((state) => state.session.socket);
  const ownPosition = useSelector(
    (state) => state.session.positions[user.attributes?.traccarToolAssignedDeviceId],
  );
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [planning, setPlanning] = useState(null);
  const [breakPlanning, setBreakPlanning] = useState(false);

  const status = game.status?.status || {};
  const controllerActive = game.status?.controllerActive === true;
  const inventory = inventoryByType(game.jokers);
  const requests = sortedRequests(game.requests);
  const reservations = reservationsView(game.jokers, game.offsetMs, now);
  const plannedBreaks = plannedBreaksView(reservations, game.offsetMs, now);
  // The member's own break marks their own pings inside it (no fake can be planned there).
  const ownDeviceId = Number(user.attributes?.traccarToolAssignedDeviceId);
  const pings = timetableView(game.timetable, {
    participants: [
      {
        deviceId: ownDeviceId,
        caught: false,
        break: breakView(status.break, game.offsetMs, now),
      },
    ],
    offsetMs: game.offsetMs,
    now,
    controllerActive,
    connected: socket !== false,
  });
  // Timetable pings that already carry the member's fake (requested or armed).
  const planned = new Set(
    requests
      .filter(
        (item) =>
          item.type === JOKER_REQUESTS.fakePing &&
          isOpenRequest(item) &&
          Number.isSafeInteger(item.parameters?.entryId),
      )
      .map((item) => item.parameters.entryId)
      .concat(reservations.filter((item) => item.use === 'timetable').map((item) => item.entryId)),
  );
  const availability = Object.fromEntries(
    JOKER_TYPES.map((type) => [
      type,
      jokerAvailability(type, {
        inventory,
        requests,
        status,
        controllerActive,
        offsetMs: game.offsetMs,
        now,
        pings,
        reservations,
      }),
    ]),
  );

  const run = useCatch(async (action) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      requestGameSync();
    }
  });

  const confirmUse = () => {
    const type = confirming;
    setConfirming(null);
    run(() => post('/api/game-requests', { type: JOKER_REQUESTS[type] }));
  };

  const fakeUses = availability.fakePing.uses;
  const startJoker = (type) => {
    if (type === 'fakePing') {
      setPlanning({ kind: fakeUses?.timetable.enabled ? 'timetable' : 'speedhunt' });
    } else setConfirming(type);
  };

  const plan = (request) => {
    setPlanning(null);
    run(() => post('/api/game-requests', request));
  };

  const takeBreak = (request) => {
    setBreakPlanning(false);
    run(() => post('/api/game-requests', request));
  };

  const cancelReservation = (id) => run(() => post(`/api/game-jokers/reservations/${id}/cancel`));

  return (
    <>
      <BreakCard
        status={status}
        offsetMs={game.offsetMs}
        now={now}
        availability={availability.break}
        planned={plannedBreaks}
        onUse={() => setBreakPlanning(true)}
        onCancel={cancelReservation}
        busy={busy}
      />
      <JokersCard
        inventory={inventory}
        availability={availability}
        onUse={startJoker}
        busy={busy}
      />
      <TimetableCard
        pings={pings}
        title={t('gameOwnPings')}
        planned={planned}
        onPlan={
          availability.fakePing.enabled && fakeUses?.timetable.enabled && !busy
            ? (ping) => setPlanning({ kind: 'timetable', entryId: ping.entryId })
            : undefined
        }
      />
      <ReservationsCard reservations={reservations} busy={busy} onCancel={cancelReservation} />
      <RequestsCard
        requests={requests}
        userId={user.id}
        offsetMs={game.offsetMs}
        now={now}
        busy={busy}
        onCancel={(id) => run(() => post(`/api/game-requests/${id}/cancel`))}
      />
      {breakPlanning && (
        <BreakPlanDialog
          available={inventory.break.available}
          nowAvailability={availability.break.now ?? availability.break}
          reasonText={(reason) => t(reasonTexts[reason])}
          serverNowMs={serverNow(game.offsetMs, now)}
          onClose={() => setBreakPlanning(false)}
          onSubmit={takeBreak}
        />
      )}
      {planning && (
        <FakePlanDialog
          kind={planning.kind}
          uses={fakeUses}
          reasonText={(reason) => t(reasonTexts[reason])}
          pings={pings.filter((item) => item.upcoming && !planned.has(item.entryId))}
          initialEntryId={planning.entryId}
          pingsPerSpeedhunt={game.jokers?.pingsPerSpeedhunt ?? null}
          center={
            ownPosition
              ? { latitude: ownPosition.latitude, longitude: ownPosition.longitude }
              : null
          }
          onClose={() => setPlanning(null)}
          onSubmit={plan}
        />
      )}
      <Dialog open={Boolean(confirming)} onClose={() => setConfirming(null)}>
        <DialogContent>
          {confirming &&
            t('gameJokerConfirm', {
              joker: t(jokerLabels[confirming]),
              available: inventory[confirming].available,
            })}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)}>{t('gameDismiss')}</Button>
          <Button variant="contained" onClick={confirmUse}>
            {t('gameConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ParticipantGameView;
