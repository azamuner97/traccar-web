import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { breakRequest, localDateTimeInput } from './gameView';
import useGameTranslation from './useGameTranslation';

// A planned break opens with this start, so the member only adjusts it.
const DEFAULT_LEAD_MS = 30 * 60 * 1000;

/**
 * Chooses when a break starts: now, or at a planned time. There is no limit on the planned time; one that
 * has passed when the request runs starts the break at once.
 */
const BreakPlanDialog = ({
  available,
  nowAvailability,
  reasonText,
  serverNowMs,
  onClose,
  onSubmit,
}) => {
  const t = useGameTranslation();
  const [when, setWhen] = useState(nowAvailability.enabled ? 'now' : 'later');
  const [time, setTime] = useState(() => localDateTimeInput(serverNowMs + DEFAULT_LEAD_MS));
  const request = breakRequest({ when, time });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('gameBreakPlanTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <RadioGroup value={when} onChange={(event) => setWhen(event.target.value)}>
            <FormControlLabel
              value="now"
              control={<Radio />}
              disabled={!nowAvailability.enabled}
              label={
                nowAvailability.enabled
                  ? t('gameBreakNow')
                  : `${t('gameBreakNow')} (${reasonText(nowAvailability.reason)})`
              }
            />
            <FormControlLabel value="later" control={<Radio />} label={t('gameBreakLater')} />
          </RadioGroup>
          {when === 'later' && (
            <TextField
              type="datetime-local"
              label={t('gameBreakStartsAt')}
              value={time}
              onChange={(event) => setTime(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          )}
          <Typography variant="caption" color="textSecondary">
            {t(when === 'later' ? 'gameBreakLaterHint' : 'gameBreakNowHint', { available })}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('gameDismiss')}</Button>
        <Button variant="contained" disabled={!request} onClick={() => onSubmit(request)}>
          {t(when === 'later' ? 'gameBreakPlan' : 'gameBreakTake')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BreakPlanDialog;
