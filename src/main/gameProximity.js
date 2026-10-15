import { gameAlertSessionDeviceId } from './gameAlerts.js';

const subscribers = new Set();
export const requestProximitySync = () => subscribers.forEach((listener) => listener());
export const subscribeProximitySync = (listener) => {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
};
export const proximityCircleSessionId = (user) =>
  ['hunter', 'spectator'].includes(user?.attributes?.traccarToolUserRole)
    ? gameAlertSessionDeviceId(user)
    : null;
export const validProximityCircle = (circle, now = Date.now()) =>
  Boolean(
    circle &&
    typeof circle.id === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(circle.id) &&
    Number.isFinite(circle.latitude) &&
    Math.abs(circle.latitude) <= 90 &&
    Number.isFinite(circle.longitude) &&
    Math.abs(circle.longitude) <= 180 &&
    Number.isFinite(circle.diameterMeters) &&
    circle.diameterMeters > 0 &&
    Number.isSafeInteger(circle.playerCount) &&
    circle.playerCount >= 0 &&
    Number.isSafeInteger(circle.supporterCount) &&
    circle.supporterCount >= 0 &&
    circle.playerCount + circle.supporterCount >= 2 &&
    typeof circle.expiresAt === 'string' &&
    circle.expiresAt.endsWith('Z') &&
    Date.parse(circle.expiresAt) > now,
  );
export const proximityCircleLabel = (circle) => {
  const parts = [];
  for (const role of ['player', 'supporter']) {
    const count = circle[`${role}Count`];
    if (count) parts.push(`${count} ${role}${count === 1 ? '' : 's'}`);
  }
  return `Participant proximity: ${parts.join(', ')}`;
};
