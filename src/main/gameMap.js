import { normalizePositiveInteger, resolveRoleMarker } from '../map/roleMarkerUtils.js';
import { gameMembership } from '../game/gameView.js';

// The live map's game filter (data model 2). Membership and catch state come only from the member's computed
// status (/api/game-status). The device markers traccarToolRole, traccarToolRoleNumber and traccarToolMirror are
// presentation the reconciler writes from member and mirror rows; here they only map members to devices, by role
// and number, which identify a member within a session (numbers are never reused).

export const mirrorDeviceAttribute = 'traccarToolMirror';
const participantRoles = new Set(['player', 'supporter']);

const memberKey = (role, number) => {
  const normalized = normalizePositiveInteger(number);
  return participantRoles.has(role) && normalized ? `${role}:${normalized}` : null;
};

/** The player or supporter a device belongs to (`role:number`), or null for hunters and unmarked devices. */
export const participantKey = (device) => {
  const marker = resolveRoleMarker(device);
  return marker ? memberKey(marker.role, marker.number) : null;
};

export const isMirrorDevice = (device) => device?.attributes?.[mirrorDeviceAttribute] === true;

/**
 * The roster of the member's own role: the catch roster (`participantOverview`) for players and supporters, the
 * participants for hunters and spectators.
 */
const roster = (status) => {
  const items = participantRoles.has(status?.role)
    ? status?.status?.participantOverview
    : status?.status?.participants;
  return Array.isArray(items) ? items : [];
};

/**
 * What the signed-in account must not see on the live map: caught players and supporters with their mirrors,
 * and (for a player or supporter) their own outgoing mirrors. Null means no filtering: administrators and
 * accounts without membership see the map unfiltered (fail-open), and so does a member until their status
 * arrives.
 */
export const gameMapFilter = (user, game) => {
  const membership = gameMembership(user, game);
  if (!membership) return null;
  const caught = new Set();
  for (const item of roster(game.status)) {
    const key = item?.caught === true ? memberKey(item.role, item.number) : null;
    if (key) caught.add(key);
  }
  return { caught, own: memberKey(membership.role, membership.number) };
};

export const filterLiveDevices = (devices, filter) =>
  Object.fromEntries(
    Object.values(devices || {})
      .filter((device) => {
        if (!filter) return true;
        const participant = participantKey(device);
        return (
          !participant ||
          (!filter.caught.has(participant) &&
            !(isMirrorDevice(device) && participant === filter.own))
        );
      })
      .map((device) => [device.id, device]),
  );

export const filterLivePositions = (positions, visibleDevices) =>
  Object.values(positions || {}).filter((position) => visibleDevices[position.deviceId]);

export const shouldClearSelectedDevice = (selectedDeviceId, visibleDevices) =>
  selectedDeviceId != null && !visibleDevices[selectedDeviceId];

/** The member's own real tracker among the visible devices (not a mirror), found by its role marker. */
export const ownTrackerId = (devices, membership) => {
  const own = memberKey(membership?.role, membership?.number);
  if (!own) return null;
  const device = Object.values(devices || {}).find(
    (item) => !isMirrorDevice(item) && participantKey(item) === own,
  );
  return device?.id ?? null;
};
