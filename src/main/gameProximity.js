const subscribers = new Set();
export const requestProximitySync = () => subscribers.forEach((listener) => listener());
export const subscribeProximitySync = (listener) => {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
};
// Proximity is scoped by game-session membership (/api/game-status): hunters and the spectator read the circles
// of their session, players and supporters their own temporary access to other participants' trackers.
export const readsProximityCircles = (membership) =>
  ['hunter', 'spectator'].includes(membership?.role);
export const readsProximityAccess = (membership) =>
  ['player', 'supporter'].includes(membership?.role);
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
