// Display helpers shared by the Game page's views.

export const capitalized = (value) =>
  String(value).charAt(0).toUpperCase() + String(value).slice(1);

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
