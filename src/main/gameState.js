import { normalizePositiveInteger, resolveRoleMarker } from '../map/roleMarkerUtils.js';

export const gameStateDeviceAttribute = 'traccarToolGameState';
export const mirrorDeviceAttribute = 'traccarToolMirror';

const gameStateVersionAttribute = 'traccarToolGameStateVersion';
const caughtParticipantsAttribute = 'traccarToolCaughtParticipants';
const participantUserRoleAttribute = 'traccarToolParticipantRole';
const participantUserNumberAttribute = 'traccarToolParticipantNumber';
const participantRoles = new Set(['player', 'supporter']);

export const isGameStateDevice = (device) =>
  device?.attributes?.[gameStateDeviceAttribute] === true;

export const participantKey = (device) => {
  const marker = resolveRoleMarker(device);
  if (!marker || !participantRoles.has(marker.role)) {
    return null;
  }
  return `${marker.role}:${marker.number}`;
};

export const participantUserKey = (user) => {
  const role = user?.attributes?.[participantUserRoleAttribute];
  const number = normalizePositiveInteger(user?.attributes?.[participantUserNumberAttribute]);
  if (!participantRoles.has(role) || !number) {
    return null;
  }
  return `${role}:${number}`;
};

export const isOwnParticipantMirror = (device, user) => {
  const userKey = participantUserKey(user);
  return Boolean(
    userKey &&
    device?.attributes?.[mirrorDeviceAttribute] === true &&
    participantKey(device) === userKey,
  );
};

const caughtKeysFromPosition = (position) => {
  const attributes = position?.attributes;
  if (
    attributes?.[gameStateDeviceAttribute] !== true ||
    attributes?.[gameStateVersionAttribute] !== 1 ||
    typeof attributes?.[caughtParticipantsAttribute] !== 'string'
  ) {
    return null;
  }

  const serialized = attributes[caughtParticipantsAttribute];
  if (!serialized) {
    return [];
  }
  const tokens = serialized.split(',');
  if (tokens.some((token) => !/^(player|supporter):[1-9]\d*$/.test(token))) {
    return null;
  }
  return tokens;
};

export const caughtParticipantKeys = (positions, gameStateIds) => {
  const result = new Set();
  Object.values(positions || {}).forEach((position) => {
    if (gameStateIds?.[position.deviceId]) {
      caughtKeysFromPosition(position)?.forEach((key) => result.add(key));
    }
  });
  return result;
};

export const filterLiveDevices = (devices, positions, gameStateIds, user) => {
  const administrator = user?.administrator === true;
  const caughtKeys = administrator ? new Set() : caughtParticipantKeys(positions, gameStateIds);
  return Object.fromEntries(
    Object.values(devices || {})
      .filter((device) => !isGameStateDevice(device))
      .filter(
        (device) =>
          administrator ||
          (!caughtKeys.has(participantKey(device)) && !isOwnParticipantMirror(device, user)),
      )
      .map((device) => [device.id, device]),
  );
};

export const filterLivePositions = (positions, visibleDevices) =>
  Object.values(positions || {}).filter((position) => visibleDevices[position.deviceId]);

export const shouldClearSelectedDevice = (selectedDeviceId, visibleDevices) =>
  selectedDeviceId != null && !visibleDevices[selectedDeviceId];
