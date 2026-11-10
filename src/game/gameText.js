// Display helpers shared by the Game page's views.

export const capitalized = (value) =>
  String(value).charAt(0).toUpperCase() + String(value).slice(1);

export const speedhuntLabel = (t, { pingCount, pingLimit }) => {
  if (!Number.isSafeInteger(pingCount) || pingCount <= 0) return t('gameSpeedhuntActive');
  return t(
    Number.isSafeInteger(pingLimit) && pingLimit > 0
      ? 'gameSpeedhuntActiveWithLimit'
      : 'gameSpeedhuntActiveWithCount',
    { count: pingCount, limit: pingLimit },
  );
};

export const requestStateColors = {
  pending: 'default',
  awaitingApproval: 'warning',
  approved: 'info',
  executing: 'info',
  succeeded: 'success',
  failed: 'error',
  rejected: 'error',
  expired: 'default',
  cancelled: 'default',
};

export const pingStateColors = {
  scheduled: 'info',
  due: 'warning',
  disconnected: 'warning',
  sent: 'success',
  skipped: 'default',
  failed: 'error',
  protected: 'success',
  out: 'default',
};
