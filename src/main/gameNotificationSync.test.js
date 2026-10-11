import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gameNotificationsActions as actions,
  gameNotificationsReducer,
} from '../store/gameNotifications.js';
import { createGameNotificationSync, validateNotificationPage } from './gameNotificationSync.js';
import { createGameNotificationCache } from './gameNotificationCache.js';

const generation = '12345678-1234-1234-1234-123456789abc';
const replacement = '87654321-1234-1234-1234-123456789abc';
const now = Date.parse('2026-10-11T12:00:00Z');
const user = {
  id: 5,
  attributes: {
    traccarToolUserRole: 'player',
    traccarToolSessionDeviceId: 900,
    traccarToolAssignedDeviceId: 100,
  },
};
const item = (id, changes = {}) => ({
  id,
  type: 'speedhunt',
  audience: 'session',
  message: 'Ping',
  occurredAt: new Date(now).toISOString(),
  timeZone: 'UTC',
  generation,
  gameStateDeviceId: 900,
  ...changes,
});
const setup = (records = [], cache = createGameNotificationCache(() => null)) => {
  let currentUser = user;
  let state = gameNotificationsReducer(undefined, {});
  let activeGeneration = generation;
  const presented = [];
  const calls = [];
  let failure;
  const dispatch = (action) => {
    state = gameNotificationsReducer(state, action);
    if (state.key) cache.save(state.key, state);
  };
  const options = {
    origin: 'https://one.test',
    getUser: () => currentUser,
    getState: () => state,
    cache,
    activate: (payload) => dispatch(actions.activate(payload)),
    add: (payload) => dispatch(actions.add(payload)),
    status: (payload) => dispatch(actions.status(payload)),
    present: (key, alerts) => {
      if (alerts.length) presented.push({ key, alerts });
    },
    now: () => now,
    fetchPage: async (query) => {
      calls.push(query);
      if (failure) throw failure;
      if (query.generation && query.generation !== activeGeneration) {
        const error = new Error('Reset');
        error.status = 409;
        throw error;
      }
      const offset = Number(query.after || 0);
      const items = records
        .slice(offset, offset + query.limit)
        .map((entry) => ({ ...entry, generation: activeGeneration }));
      return {
        version: 2,
        sessionDeviceId: 900,
        generation: activeGeneration,
        items,
        nextCursor: String(offset + items.length),
        hasMore: offset + items.length < records.length,
      };
    },
  };
  return {
    sync: createGameNotificationSync(options),
    options,
    cache,
    calls,
    presented,
    state: () => state,
    dispatch,
    records,
    setUser: (value) => {
      currentUser = value;
    },
    fail: (value) => {
      failure = value;
    },
    reset: () => {
      activeGeneration = replacement;
      records.splice(0);
    },
  };
};

test('full-session pages recover old history silently and fresh records once', async () => {
  const context = setup(
    Array.from({ length: 250 }, (_, i) => item(String(i), { occurredAt: '2026-01-01T00:00:00Z' })),
  );
  await context.sync.schedule();
  assert.equal(context.state().items.length, 250);
  assert.equal(context.presented.length, 0);
  context.records.push(item('fresh'));
  await context.sync.schedule();
  assert.equal(context.presented.length, 1);
  assert.equal(context.presented[0].alerts[0].id, 'fresh');
  await context.sync.schedule();
  assert.equal(context.presented.length, 1);
  assert.equal(context.state().cursor, '251');
});
test('reload hydration never plays and deletion cannot be restored', async () => {
  const context = setup([item('one')]);
  await context.sync.schedule();
  context.dispatch(actions.delete({ key: context.state().key, id: 'one' }));
  context.cache.save(`active:${JSON.stringify(['https://one.test', 5, 900])}`, { generation });
  const reload = setup(context.records, context.cache);
  await reload.sync.schedule();
  assert.equal(reload.state().items.length, 0);
  assert.equal(reload.presented.length, 0);
});
test('reset invalidates old generation and restores a clean history', async () => {
  const context = setup([item('one')]);
  await context.sync.schedule();
  context.reset();
  await context.sync.schedule();
  assert.equal(context.state().generation, replacement);
  assert.equal(context.state().items.length, 0);
  assert.equal(context.state().handled.length, 0);
});
test('failures retain cached history and do not advance cursor', async () => {
  const context = setup([item('one')]);
  await context.sync.schedule();
  context.fail(new Error('Offline'));
  await context.sync.schedule();
  assert.equal(context.state().items.length, 1);
  assert.equal(context.state().cursor, '1');
  assert.equal(context.state().error, 'Offline');
});
test('blocked/corrupt storage falls back to memory without legacy loading', async () => {
  const cache = createGameNotificationCache(() => {
    throw new Error('Denied');
  });
  await cache.save('scope', { items: [item('one')] });
  assert.equal((await cache.load('scope')).items.length, 1);
  const context = setup([item('two')], {
    load: async () => ({ handled: 1, cursor: {}, items: 'corrupt' }),
    save() {},
  });
  await context.sync.schedule();
  assert.equal(context.state().items.length, 1);
});
test('cancelled/account-changed responses cannot update state', async () => {
  let release;
  const context = setup([item('one')]);
  const sync = createGameNotificationSync({
    ...context.options,
    fetchPage: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const waiting = sync.schedule();
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  sync.cancel();
  context.setUser(null);
  release({
    version: 2,
    sessionDeviceId: 900,
    generation,
    items: [],
    nextCursor: '0',
    hasMore: false,
  });
  await waiting;
  assert.equal(context.state().key, null);
});
test('malformed API versions, stale scope and legacy types fail closed', () => {
  const valid = {
    version: 2,
    sessionDeviceId: 900,
    generation,
    items: [item('one')],
    nextCursor: '1',
    hasMore: false,
  };
  assert.equal(validateNotificationPage(valid, user, now), valid);
  for (const changes of [
    { version: 1 },
    { sessionDeviceId: 901 },
    { generation: 'invalid' },
    { items: [item('one', { audience: 'participants' })] },
    { nextCursor: '-1' },
    { nextCursor: '9223372036854775808' },
  ]) {
    assert.throws(() => validateNotificationPage({ ...valid, ...changes }, user, now));
  }
});

test('targeted pages accept this user and reject another recipient', () => {
  const targeted = item('exit', {
    type: 'geofenceExit',
    audience: 'user',
    recipientUserId: 5,
    sourceDeviceId: 100,
  });
  const valid = {
    version: 2,
    sessionDeviceId: 900,
    generation,
    items: [targeted],
    nextCursor: '1',
    hasMore: false,
  };
  assert.equal(validateNotificationPage(valid, user, now), valid);
  assert.throws(() =>
    validateNotificationPage({ ...valid, items: [{ ...targeted, recipientUserId: 6 }] }, user, now),
  );
});

test('interrupted pages resume at the processed cursor and present only after completion', async () => {
  const context = setup(Array.from({ length: 205 }, (_, i) => item('fresh-' + i)));
  let interrupted = false;
  const sync = createGameNotificationSync({
    ...context.options,
    fetchPage: async (query, signal) => {
      if (query.after === '100' && !interrupted) {
        interrupted = true;
        throw new Error('Interrupted page');
      }
      return context.options.fetchPage(query, signal);
    },
  });
  await sync.schedule();
  assert.equal(context.state().cursor, '100');
  assert.equal(context.state().items.length, 100);
  assert.equal(context.presented.length, 0);
  await sync.schedule();
  assert.equal(context.state().cursor, '205');
  assert.equal(context.state().items.length, 205);
  assert.equal(context.presented.length, 1);
  assert.equal(context.presented[0].alerts.length, 205);
  await sync.schedule();
  assert.equal(context.presented.length, 1);
});

test('a reset between metadata and page retrieval restarts in the new generation', async () => {
  const context = setup([item('old')]);
  let reset = false;
  const sync = createGameNotificationSync({
    ...context.options,
    fetchPage: async (query, signal) => {
      if (query.generation && !reset) {
        reset = true;
        context.reset();
      }
      return context.options.fetchPage(query, signal);
    },
  });
  await sync.schedule();
  assert.equal(context.state().generation, replacement);
  assert.deepEqual(context.state().items, []);
  assert.deepEqual(context.state().handled, []);
  assert.equal(context.presented.length, 0);
});

test('overlapping invalidations coalesce without duplicate presentation', async () => {
  const context = setup([item('one')]);
  let release;
  let first = true;
  const sync = createGameNotificationSync({
    ...context.options,
    fetchPage: async (query, signal) => {
      if (first) {
        first = false;
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      return context.options.fetchPage(query, signal);
    },
  });
  const running = sync.schedule();
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all([sync.schedule(), sync.schedule(), sync.schedule()]);
  release();
  await running;
  assert.equal(context.calls.length, 4);
  assert.equal(context.presented.length, 1);
});

test('corrupt snapshots cannot skip server history with an unchecked cursor', async () => {
  const context = setup([item('recover')], {
    load: async () => ({ generation, cursor: '999', items: 'invalid', handled: [], deleted: [] }),
    save() {},
  });
  await context.sync.schedule();
  assert.equal(context.state().items[0].id, 'recover');
  assert.equal(context.state().cursor, '1');
});

test('overflowed cached cursors recover from the beginning instead of causing permanent API errors', async () => {
  const context = setup([item('recover')], {
    load: async () => ({
      generation,
      cursor: '9999999999999999999',
      items: [],
      handled: [],
      deleted: [],
    }),
    save() {},
  });
  await context.sync.schedule();
  assert.equal(context.state().items[0].id, 'recover');
  assert.equal(context.state().cursor, '1');
});

test('hydration reapplies deletion tombstones and clear cutoffs without presenting cached records', async () => {
  const records = [
    item('deleted'),
    item('cleared'),
    item('kept', { occurredAt: new Date(now + 1).toISOString() }),
  ];
  const context = setup(records, {
    load: async () => ({
      generation,
      cursor: '3',
      items: records.map((record) => ({ ...record, read: false })),
      handled: [],
      deleted: ['deleted'],
      clearBefore: now,
    }),
    save() {},
  });
  await context.sync.schedule();
  assert.deepEqual(
    context.state().items.map((record) => record.id),
    ['kept'],
  );
  assert.equal(context.presented.length, 0);
});

test('permission denial clears active state while retaining handled cache for later authorization', async () => {
  const context = setup([item('one')]);
  const sync = createGameNotificationSync({
    ...context.options,
    revoke: () => context.dispatch(actions.deactivate()),
  });
  await sync.schedule();
  const error = new Error('Forbidden');
  error.status = 403;
  context.fail(error);
  await sync.schedule();
  assert.equal(context.state().key, null);
  assert.deepEqual(context.state().items, []);
  assert.equal(context.state().error, 'Forbidden');
  context.fail(null);
  await sync.schedule();
  assert.equal(context.state().items.length, 1);
  assert.equal(context.presented.length, 1, 'already handled alerts remain silent');
});
