export const MAX_REPLAY_DEVICES = 50;
export const MAX_REPLAY_RANGE = 48 * 60 * 60 * 1000;
export const REPLAY_POSITION_LIFETIME = 2 * 60 * 1000;
export const REPLAY_SPEEDS = [1, 10, 100, 1000];

export const parseReplaySpeed = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const positiveId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const resolveReplayDeviceIds = (devices, groups, deviceIds, groupIds) => {
  const hasRequestedSelection = Boolean(deviceIds?.length || groupIds?.length);
  const deviceItems = Object.values(devices || {});
  const deviceById = new Map(
    deviceItems
      .map((device) => [positiveId(device.id), device])
      .filter(([deviceId]) => deviceId !== null),
  );
  const requestedDeviceIds = new Set(
    (deviceIds || []).map(positiveId).filter((deviceId) => deviceById.has(deviceId)),
  );
  const requestedGroupIds = new Set((groupIds || []).map(positiveId).filter(Boolean));

  if (!hasRequestedSelection) {
    return [...deviceById.keys()].sort((first, second) => first - second);
  }

  const groupById = new Map(
    Object.values(groups || {})
      .map((group) => [positiveId(group.id), group])
      .filter(([groupId]) => groupId !== null),
  );
  const belongsToRequestedGroup = (initialGroupId) => {
    let groupId = positiveId(initialGroupId);
    const visited = new Set();
    while (groupId !== null && !visited.has(groupId)) {
      if (requestedGroupIds.has(groupId)) {
        return true;
      }
      visited.add(groupId);
      groupId = positiveId(groupById.get(groupId)?.groupId);
    }
    return false;
  };

  deviceItems.forEach((device) => {
    const deviceId = positiveId(device.id);
    if (deviceId !== null && belongsToRequestedGroup(device.groupId)) {
      requestedDeviceIds.add(deviceId);
    }
  });

  return [...requestedDeviceIds].sort((first, second) => first - second);
};

export const validateReplayRange = (from, to) => {
  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) {
    throw Error('Replay period contains an invalid date.');
  }
  if (fromTime >= toTime) {
    throw Error('Replay start time must be earlier than the end time.');
  }
  if (toTime - fromTime > MAX_REPLAY_RANGE) {
    throw Error('Replay period cannot exceed 48 hours.');
  }
  return { fromTime, toTime };
};

export const validateReplayDeviceIds = (deviceIds) => {
  if (!deviceIds.length) {
    throw Error('Replay requires at least one accessible device.');
  }
  if (deviceIds.length > MAX_REPLAY_DEVICES) {
    throw Error(
      `Replay supports up to ${MAX_REPLAY_DEVICES} devices; ${deviceIds.length} were selected.`,
    );
  }
  return deviceIds;
};

export const buildReplayQuery = (deviceIds, from, to) => {
  if (!deviceIds.length) {
    throw Error('Replay requires at least one device.');
  }
  const query = new URLSearchParams({ from, to });
  deviceIds.forEach((deviceId) => query.append('deviceId', deviceId));
  return query;
};

export const clearReplayPeriod = (searchParams) => {
  const result = new URLSearchParams(searchParams);
  result.delete('from');
  result.delete('to');
  return result;
};

export const buildReplayTracks = (positions, fromTime, toTime, deviceIds) => {
  const allowedDeviceIds = new Set(deviceIds);
  const tracks = new Map();

  (Array.isArray(positions) ? positions : []).forEach((position, replayOrder) => {
    const deviceId = positiveId(position?.deviceId);
    const replayTime = Date.parse(position?.fixTime);
    const latitude = Number(position?.latitude);
    const longitude = Number(position?.longitude);
    if (
      deviceId === null ||
      !allowedDeviceIds.has(deviceId) ||
      !Number.isFinite(replayTime) ||
      replayTime < fromTime ||
      replayTime > toTime ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return;
    }

    if (!tracks.has(deviceId)) {
      tracks.set(deviceId, []);
    }
    tracks.get(deviceId).push({
      ...position,
      deviceId,
      latitude,
      longitude,
      _replayTime: replayTime,
      _replayOrder: replayOrder,
    });
  });

  tracks.forEach((track) => {
    track.sort(
      (first, second) =>
        first._replayTime - second._replayTime || first._replayOrder - second._replayOrder,
    );
  });

  return new Map([...tracks].sort(([first], [second]) => first - second));
};

export const findPositionAtOrBefore = (track, replayTime) => {
  let lower = 0;
  let upper = track.length - 1;
  let result = null;

  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (track[middle]._replayTime <= replayTime) {
      result = track[middle];
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  return result;
};

export const getReplaySnapshot = (tracks, replayTime) => {
  const snapshot = [];
  tracks.forEach((track) => {
    const position = findPositionAtOrBefore(track, replayTime);
    if (position && replayTime - position._replayTime <= REPLAY_POSITION_LIFETIME) {
      snapshot.push(position);
    }
  });
  return snapshot;
};

export const clampReplayTime = (value, fromTime, toTime) =>
  Math.min(toTime, Math.max(fromTime, value));

export const advanceReplayTime = (currentTime, elapsedTime, speed, toTime) =>
  Math.min(toTime, currentTime + Math.max(0, elapsedTime) * speed);
