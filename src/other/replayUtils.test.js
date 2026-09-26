import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_REPLAY_RANGE,
  REPLAY_POSITION_LIFETIME,
  REPLAY_SPEEDS,
  advanceReplayTime,
  buildReplayQuery,
  buildReplayTracks,
  clearReplayPeriod,
  clampReplayTime,
  findPositionAtOrBefore,
  getReplaySnapshot,
  parseReplaySpeed,
  resolveReplayDeviceIds,
  validateReplayDeviceIds,
  validateReplayRange,
} from './replayUtils.js';

const iso = (milliseconds) => new Date(milliseconds).toISOString();

test('resolves explicit devices and nested groups without duplicates', () => {
  const devices = {
    1: { id: 1, groupId: 10 },
    2: { id: 2, groupId: 11 },
    3: { id: 3, groupId: 12 },
    4: { id: 4, groupId: 0 },
  };
  const groups = {
    10: { id: 10, groupId: 0 },
    11: { id: 11, groupId: 10 },
    12: { id: 12, groupId: 11 },
  };

  assert.deepEqual(resolveReplayDeviceIds(devices, groups, [4, 2, 2], [10]), [1, 2, 3, 4]);
  assert.deepEqual(resolveReplayDeviceIds(devices, groups, [], []), [1, 2, 3, 4]);
});

test('group resolution terminates safely for cyclic, unknown, and inaccessible selections', () => {
  const devices = {
    1: { id: 1, groupId: 10 },
    2: { id: 2, groupId: 20 },
  };
  const groups = {
    10: { id: 10, groupId: 11 },
    11: { id: 11, groupId: 10 },
  };

  assert.deepEqual(resolveReplayDeviceIds(devices, groups, [], [11]), [1]);
  assert.deepEqual(resolveReplayDeviceIds(devices, groups, [], [99]), []);
  assert.deepEqual(resolveReplayDeviceIds(devices, groups, [99], []), []);
});

test('validates replay range boundaries', () => {
  const from = Date.UTC(2026, 0, 1);
  assert.deepEqual(validateReplayRange(iso(from), iso(from + MAX_REPLAY_RANGE)), {
    fromTime: from,
    toTime: from + MAX_REPLAY_RANGE,
  });
  assert.throws(() => validateReplayRange('invalid', iso(from + 1)), /invalid date/);
  assert.throws(() => validateReplayRange(iso(from), iso(from)), /earlier/);
  assert.throws(() => validateReplayRange(iso(from), iso(from + MAX_REPLAY_RANGE + 1)), /48 hours/);
});

test('accepts one through 50 devices and rejects empty or larger selections', () => {
  const oneDevice = [1];
  const fiftyDevices = Array.from({ length: 50 }, (_, index) => index + 1);
  assert.equal(validateReplayDeviceIds(oneDevice), oneDevice);
  assert.equal(validateReplayDeviceIds(fiftyDevices), fiftyDevices);
  assert.throws(() => validateReplayDeviceIds([]), /at least one/);
  assert.throws(() => validateReplayDeviceIds([...fiftyDevices, 51]), /up to 50/);
});

test('builds an explicit repeated-device route query', () => {
  const query = buildReplayQuery([3, 7], 'from-value', 'to-value');
  assert.deepEqual(query.getAll('deviceId'), ['3', '7']);
  assert.equal(query.get('from'), 'from-value');
  assert.equal(query.get('to'), 'to-value');
  assert.throws(() => buildReplayQuery([], 'from', 'to'), /at least one/);
});

test('clears only the replay period when returning to the filter', () => {
  const source = new URLSearchParams('deviceId=1&deviceId=2&groupId=3&from=from-value&to=to-value');
  const result = clearReplayPeriod(source);

  assert.deepEqual(result.getAll('deviceId'), ['1', '2']);
  assert.deepEqual(result.getAll('groupId'), ['3']);
  assert.equal(result.has('from'), false);
  assert.equal(result.has('to'), false);
});

test('builds sorted tracks and ignores invalid or out-of-range positions', () => {
  const from = Date.UTC(2026, 0, 1, 10);
  const to = from + 60_000;
  const tracks = buildReplayTracks(
    [
      { id: 2, deviceId: 1, fixTime: iso(from + 20_000), latitude: 2, longitude: 2 },
      { id: 3, deviceId: 2, fixTime: iso(from + 10_000), latitude: 3, longitude: 3 },
      { id: 1, deviceId: 1, fixTime: iso(from + 10_000), latitude: 1, longitude: 1 },
      { id: 4, deviceId: 1, fixTime: iso(from + 10_000), latitude: 4, longitude: 4 },
      { id: 5, deviceId: 1, fixTime: 'invalid', latitude: 5, longitude: 5 },
      { id: 6, deviceId: 3, fixTime: iso(from + 10_000), latitude: 6, longitude: 6 },
      { id: 7, deviceId: 1, fixTime: iso(to + 1), latitude: 7, longitude: 7 },
      { id: 8, deviceId: 1, fixTime: iso(from + 30_000), latitude: 'bad', longitude: 8 },
    ],
    from,
    to,
    [1, 2],
  );

  assert.deepEqual([...tracks.keys()], [1, 2]);
  assert.deepEqual(
    tracks.get(1).map((position) => position.id),
    [1, 4, 2],
  );
  assert.deepEqual(
    tracks.get(2).map((position) => position.id),
    [3],
  );
});

test('uses the latest fix at or before the shared replay time', () => {
  const from = Date.UTC(2026, 0, 1, 10);
  const positions = [
    { id: 1, deviceId: 1, fixTime: iso(from + 10_000), latitude: 1, longitude: 1 },
    { id: 2, deviceId: 1, fixTime: iso(from + 20_000), latitude: 2, longitude: 2 },
    { id: 3, deviceId: 1, fixTime: iso(from + 20_000), latitude: 3, longitude: 3 },
    { id: 4, deviceId: 2, fixTime: iso(from + 15_000), latitude: 4, longitude: 4 },
  ];
  const tracks = buildReplayTracks(positions, from, from + 60_000, [1, 2]);

  assert.equal(findPositionAtOrBefore([], from + 9_999), null);
  assert.equal(findPositionAtOrBefore(tracks.get(1), from + 9_999), null);
  assert.equal(findPositionAtOrBefore(tracks.get(1), from + 10_000).id, 1);
  assert.equal(findPositionAtOrBefore(tracks.get(1), from + 20_000).id, 3);
  assert.deepEqual(getReplaySnapshot(tracks, from), []);
  assert.deepEqual(
    getReplaySnapshot(tracks, from + 16_000).map((position) => position.id),
    [1, 4],
  );
});

test('expires positions after two minutes and shows the next fix', () => {
  const from = Date.UTC(2026, 0, 1, 10);
  const nextFixTime = from + REPLAY_POSITION_LIFETIME + 60_000;
  const tracks = buildReplayTracks(
    [
      { id: 1, deviceId: 1, fixTime: iso(from), latitude: 1, longitude: 1 },
      { id: 2, deviceId: 1, fixTime: iso(nextFixTime), latitude: 2, longitude: 2 },
    ],
    from,
    nextFixTime + REPLAY_POSITION_LIFETIME,
    [1],
  );

  assert.deepEqual(
    getReplaySnapshot(tracks, from + REPLAY_POSITION_LIFETIME).map((position) => position.id),
    [1],
  );
  assert.deepEqual(getReplaySnapshot(tracks, from + REPLAY_POSITION_LIFETIME + 1), []);
  assert.deepEqual(
    getReplaySnapshot(tracks, nextFixTime).map((position) => position.id),
    [2],
  );
});

test('provides the replay speed presets and accepts every positive finite custom speed', () => {
  assert.deepEqual(REPLAY_SPEEDS, [1, 10, 100, 1000]);
  assert.equal(parseReplaySpeed(String(Number.MIN_VALUE)), Number.MIN_VALUE);
  assert.equal(parseReplaySpeed('1.25'), 1.25);
  assert.equal(parseReplaySpeed(String(Number.MAX_VALUE)), Number.MAX_VALUE);
  assert.equal(parseReplaySpeed('invalid'), null);
  assert.equal(parseReplaySpeed(''), null);
  assert.equal(parseReplaySpeed('0'), null);
  assert.equal(parseReplaySpeed('-1'), null);
  assert.equal(parseReplaySpeed('Infinity'), null);
});

test('clamps seeking and advances by elapsed time and speed', () => {
  assert.equal(clampReplayTime(5, 10, 20), 10);
  assert.equal(clampReplayTime(25, 10, 20), 20);
  assert.equal(clampReplayTime(15, 10, 20), 15);
  assert.equal(advanceReplayTime(1_000, 500, 2, 10_000), 2_000);
  assert.equal(advanceReplayTime(9_500, 500, 2, 10_000), 10_000);
  assert.equal(advanceReplayTime(1_000, -500, 2, 10_000), 1_000);
});
