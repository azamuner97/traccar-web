// The stock Manager delivers one FCM token per phone. Preserve every registered
// phone, rather than silently dropping older phones after a third login.
export const notificationTokens = (value) => [
  ...new Set(typeof value === 'string' ? value.split(/[,\s]+/).filter(Boolean) : []),
];

export const addNotificationToken = (value, token) =>
  [...new Set([...notificationTokens(value), ...notificationTokens(token)])].join(',');

export const removeNotificationToken = (value, token) =>
  notificationTokens(value)
    .filter((item) => item !== token)
    .join(',');
