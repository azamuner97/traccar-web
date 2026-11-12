import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gameNotificationsActions as actions,
  gameNotificationsReducer,
} from '../store/gameNotifications.js';
import { createGameNotificationSync, validateNotificationPage } from './gameNotificationSync.js';
import { createGameNotificationCache } from './gameNotificationCache.js';
import { canReceiveGameAlert } from './gameAlerts.js';

const generation = '12345678-1234-1234-1234-123456789abc';
const replacement = '87654321-1234-1234-1234-123456789abc';
const now = Date.parse('2026-10-11T12:00:00Z');
// The membership /api/game-status names; user attributes play no part.
const member = { userId: 5, gameSessionId: 3, memberId: 40, role: 'player', number: 1 };
// A notification entry as the server returns it: no session, null members for session and role alerts.
const item = (id, changes = {}) => ({
  id,
  type: 'speedhunt',
  audience: 'session',
  message: 'Ping',
  occurredAt: new Date(now).toISOString(),
  timeZone: 'UTC',
  recipientMemberId: null,
  recipientLabel: null,
  sourceMemberId: null,
  sourceLabel: null,
  generation,
  createdAt: new Date(now).toISOString(),
  ...changes,
});
const personal = (id, memberId = member.memberId) =>
  item(id, {
    type: 'liveTrackingStarted',
    audience: 'user',
    recipientMemberId: memberId,
    sourceMemberId: memberId,
  });
const page = (items, changes = {}) => ({
  generation,
  resetAt: '2026-10-11T08:00:00Z',
  items,
  nextCursor: String(items.length),
  hasMore: false,
  ...changes,
});
const setup = (records = [], cache = createGameNotificationCache(() => null)) => {
  let currentMembership = member;
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
    getMembership: () => currentMembership,
    getState: () => state,
    cache,
    activate: (payload) => dispatch(actions.activate(payload)),
    add: (payload) => dispatch(actions.add(payload)),
    status: (payload) => dispatch(actions.status(payload)),
    present: (key, alerts) => {
      if (alerts.length) presented.push({ key, alerts });
    },
    now: () => now,
    // The server's member view: its own session only, filtered by role and member.
    fetchPage: async (query) => {
      calls.push(query);
      if (failure) throw failure;
      if (query.gameSessionId !== currentMembership?.gameSessionId) {
        const error = new Error('Forbidden');
        error.status = 403;
        throw error;
      }
      if (query.generation && query.generation !== activeGeneration) {
        const error = new Error('Reset');
        error.status = 409;
        throw error;
      }
      const offset = Number(query.after || 0);
      const eligible = records.filter((entry) =>
        canReceiveGameAlert({ ...entry, gameSessionId: query.gameSessionId }, currentMembership),
      );
      const items = eligible
        .slice(offset, offset + query.limit)
        .map((entry) => ({ ...entry, generation: activeGeneration }));
      return {
        generation: activeGeneration,
        resetAt: '2026-10-11T08:00:00Z',
        items,
        nextCursor: String(offset + items.length),
        hasMore: offset + items.length < eligible.length,
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
    setMembership: (value) => {
      currentMembership = value;
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

test('pages are requested for the member session and items carry it', async () => {
  const context = setup([item('one')]);
  await context.sync.schedule();
  assert.deepEqual(context.calls[0], { gameSessionId: 3, limit: 1 });
  assert.deepEqual(context.calls[1], { gameSessionId: 3, generation, after: '0', limit: 100 });
  assert.equal(context.state().items[0].gameSessionId, 3);
  assert.equal(context.state().items[0].createdAt, undefined, 'only the alert fields are kept');
});

test('a role change (a new member) reloads the authorized stream without replaying handled session records', async () => {
  const context = setup([item('session'), personal('old')]);
  await context.sync.schedule();
  context.cache.save(`active:${JSON.stringify(['https://one.test', 5, 3])}`, { generation });
  context.setMembership({ ...member, memberId: 41, role: 'supporter' });
  context.records.splice(0, 2, item('session'), personal('new', 41));
  context.dispatch(actions.setDrawerVisible({ key: context.state().key, visible: true }));
  const changed = createGameNotificationSync(context.options);
  await changed.schedule();
  assert.deepEqual(
    context
      .state()
      .items.map((entry) => entry.id)
      .sort(),
    ['new', 'session'],
  );
  assert.equal(context.state().cursor, '2');
  assert.equal(context.presented.length, 2);
  assert.deepEqual(
    context.presented[1].alerts.map((entry) => entry.id),
    ['new'],
  );
  assert.equal(context.state().drawerVisible, true);
  assert.ok(context.state().items.every((entry) => entry.read));
});

test('a tracker replacement keeps the member and its personal history', async () => {
  const context = setup([item('session'), personal('mine')]);
  await context.sync.schedule();
  const key = context.state().key;
  // The member keeps its ID when its tracker changes; nothing about the membership changes.
  context.setMembership({ ...member });
  await createGameNotificationSync(context.options).schedule();
  assert.equal(context.state().key, key);
  assert.deepEqual(
    context
      .state()
      .items.map((entry) => entry.id)
      .sort(),
    ['mine', 'session'],
  );
  assert.equal(context.presented.length, 1, 'nothing is presented twice');
});

test('permission changes cancel in-flight pages even when account and session stay unchanged', async () => {
  const context = setup();
  let release;
  const changed = createGameNotificationSync({
    ...context.options,
    fetchPage: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const running = changed.schedule();
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  context.setMembership({ ...member, memberId: 41, role: 'spectator' });
  release(page([item('late')]));
  await running;
  assert.equal(context.state().key, null);
  assert.equal(context.presented.length, 0);
});

test('reload hydration never plays and deletion cannot be restored', async () => {
  const context = setup([item('one')]);
  await context.sync.schedule();
  context.dispatch(actions.delete({ key: context.state().key, id: 'one' }));
  context.cache.save(`active:${JSON.stringify(['https://one.test', 5, 3])}`, { generation });
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
  context.setMembership(null);
  release(page([]));
  await waiting;
  assert.equal(context.state().key, null);
});
test('malformed pages, another session and legacy types fail closed', () => {
  const valid = page([item('one')]);
  const checked = validateNotificationPage(valid, member, now);
  assert.equal(checked.items[0].gameSessionId, 3, 'items are stamped with the requested session');
  assert.equal(valid.items[0].gameSessionId, undefined, 'the response is not changed');
  assert.deepEqual(validateNotificationPage(page([], { generation: null }), member, now).items, []);
  for (const changes of [
    { generation: 'invalid' },
    { generation: null },
    { items: [item('one', { audience: 'participants' })] },
    { items: [item('one', { generation: replacement })] },
    { items: [item('one', { recipientMemberId: 40 })] },
    { items: 'none' },
    { hasMore: 'no' },
    { nextCursor: '-1' },
    { nextCursor: '9223372036854775808' },
  ]) {
    assert.throws(() => validateNotificationPage({ ...valid, ...changes }, member, now));
  }
  assert.throws(() => validateNotificationPage(valid, null, now), 'no membership');
});

test('targeted pages accept alerts about this member and reject another recipient or source', () => {
  const targeted = personal('exit');
  const valid = page([targeted]);
  assert.equal(validateNotificationPage(valid, member, now).items.length, 1);
  for (const changes of [
    { recipientMemberId: 41, sourceMemberId: 41 },
    { sourceMemberId: 41 },
    { recipientMemberId: null },
  ]) {
    assert.throws(() => validateNotificationPage(page([{ ...targeted, ...changes }]), member, now));
  }
  assert.throws(
    () => validateNotificationPage(valid, { ...member, role: 'spectator' }, now),
    'spectators get no targeted alerts',
  );
});

test('live-recipient pages accept another source for this member and role only', () => {
  const received = item('received', {
    type: 'livePingReceived',
    audience: 'livePlayer',
    recipientMemberId: 40,
    sourceMemberId: 20,
  });
  assert.equal(validateNotificationPage(page([received]), member, now).items.length, 1);
  assert.throws(() =>
    validateNotificationPage(page([received]), { ...member, role: 'supporter' }, now),
  );
  assert.throws(() =>
    validateNotificationPage(page([{ ...received, sourceMemberId: 40 }]), member, now),
  );
});

test('role-filtered history rejects named Speedhunt records for participants and anonymous variants for hunters and spectators', () => {
  for (const role of ['player', 'supporter', 'hunter', 'spectator']) {
    const viewer = { ...member, role };
    const named = ['hunter', 'spectator'].includes(role);
    assert.doesNotThrow(() =>
      validateNotificationPage(
        page([item('ping', { audience: named ? 'hunters' : 'nonHunters' })]),
        viewer,
        now,
      ),
    );
    assert.throws(() =>
      validateNotificationPage(
        page([item('ping', { audience: named ? 'nonHunters' : 'hunters' })]),
        viewer,
        now,
      ),
    );
  }
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
      // Cached items carry the session the page that delivered them was requested for.
      items: records.map((record) => ({ ...record, gameSessionId: 3, read: false })),
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
