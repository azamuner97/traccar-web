import { useEffect, useId, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { formatTime } from '../common/util/formatter';
import useGameTranslation from './useGameTranslation';

const statusLabels = {
  inProgress: 'gameSpeedhuntHistoryInProgress',
  paused: 'gameSpeedhuntHistoryPaused',
  finished: 'gameSpeedhuntHistoryFinished',
};

const SpeedhuntHistoryCard = ({ gameSessionId, controllerActive, refreshedAt, statusError }) => {
  const t = useGameTranslation();
  const titleId = useId();
  const [history, setHistory] = useState({ runs: null, failed: false });
  const [retry, setRetry] = useState(0);
  const [visibleCount, setVisibleCount] = useState(3);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch('/api/game-status/speedhunt-history', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (response.status === 401 || response.status === 403) {
          if (!controller.signal.aborted) setHistory({ runs: null, failed: true });
          return;
        }
        if (!response.ok) throw new Error('Could not load Speedhunt history');
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (result?.gameSessionId !== gameSessionId) {
          setHistory({ runs: null, failed: true });
          return;
        }
        if (!Array.isArray(result.runs)) throw new Error('Invalid Speedhunt history');
        setHistory({ runs: result.runs, failed: false });
      } catch {
        if (!controller.signal.aborted) setHistory((current) => ({ ...current, failed: true }));
      }
    };
    load();
    return () => controller.abort();
  }, [gameSessionId, refreshedAt, statusError, retry]);

  const { runs, failed } = history;
  return (
    <Card component="section" aria-labelledby={titleId} variant="outlined">
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Typography id={titleId} component="h2" variant="h6">
          {t('gameSpeedhuntHistory')}
        </Typography>
        {failed && (
          <Alert
            severity={runs ? 'warning' : 'error'}
            sx={{ mt: 1 }}
            action={
              <Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>
                {t('gameRetry')}
              </Button>
            }
          >
            {t(runs ? 'gameRefreshFailed' : 'gameSpeedhuntHistoryUnavailable')}
          </Alert>
        )}
        {!runs && !failed && (
          <Typography role="status" color="textSecondary">
            {t('gameSpeedhuntHistoryLoading')}
          </Typography>
        )}
        {runs?.length === 0 && (
          <Typography color="textSecondary">{t('gameSpeedhuntHistoryEmpty')}</Typography>
        )}
      </CardContent>
      {runs?.slice(0, visibleCount).map(({ id, startedAt, status, pings }, index) => {
        const runStatus = status === 'inProgress' && !controllerActive ? 'paused' : status;
        const inProgress = runStatus === 'inProgress';
        const startDate = formatTime(startedAt, 'date');
        return (
          <Accordion
            key={id}
            disableGutters
            square
            elevation={0}
            expanded={expanded[id] ?? index === 0}
            onChange={(_, open) => setExpanded((current) => ({ ...current, [id]: open }))}
            slotProps={{ transition: { unmountOnExit: true } }}
            sx={{ borderTop: 1, borderColor: 'divider', '&::before': { display: 'none' } }}
          >
            <AccordionSummary
              id={`${titleId}-run-${id}`}
              aria-controls={`${titleId}-pings-${id}`}
              expandIcon={<ExpandMoreIcon />}
            >
              <Stack
                direction="row"
                sx={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  flex: 1,
                  gap: 0.75,
                  mr: 1,
                }}
              >
                <Stack
                  direction="row"
                  sx={{ alignItems: 'baseline', flexWrap: 'wrap', columnGap: 0.75 }}
                >
                  <Typography variant="caption" color="textSecondary">
                    {t('gameSpeedhuntHistoryStarted')}
                  </Typography>
                  <Typography component="time" dateTime={startedAt} variant="subtitle2">
                    {formatTime(startedAt)}
                  </Typography>
                </Stack>
                <Chip
                  size="small"
                  color={inProgress ? 'error' : 'default'}
                  variant={inProgress ? 'filled' : 'outlined'}
                  label={t(statusLabels[runStatus])}
                />
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              {pings.length === 0 ? (
                <Typography variant="body2" color="textSecondary">
                  {t('gameSpeedhuntHistoryNoPings')}
                </Typography>
              ) : (
                <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                  {pings.map(({ number, sentAt, type }) => (
                    <Stack
                      component="li"
                      key={number}
                      direction="row"
                      sx={{
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 1,
                        py: 0.75,
                        borderTop: 1,
                        borderColor: 'divider',
                      }}
                    >
                      <Typography variant="body2">
                        {t('gameSpeedhuntHistoryPing', { number })}
                      </Typography>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography
                          component="time"
                          dateTime={sentAt}
                          variant="body2"
                          color="textSecondary"
                        >
                          {formatTime(
                            sentAt,
                            formatTime(sentAt, 'date') === startDate ? 'time' : undefined,
                          )}
                        </Typography>
                        <Chip
                          size="small"
                          variant="outlined"
                          color={type === 'live' ? 'primary' : 'default'}
                          label={t(type === 'live' ? 'gameLive' : 'gameSpeedhuntHistoryStatic')}
                        />
                      </Stack>
                    </Stack>
                  ))}
                </Box>
              )}
            </AccordionDetails>
          </Accordion>
        );
      })}
      {runs?.length > visibleCount && (
        <Box sx={{ px: 2, py: 1, borderTop: 1, borderColor: 'divider' }}>
          <Button size="small" onClick={() => setVisibleCount((count) => count + 10)}>
            {t('gameSpeedhuntHistoryShowMore')}
          </Button>
        </Box>
      )}
    </Card>
  );
};

export default SpeedhuntHistoryCard;
