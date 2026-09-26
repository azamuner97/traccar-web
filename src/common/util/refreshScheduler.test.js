import assert from 'node:assert/strict';
import test from 'node:test';

import createRefreshScheduler from './refreshScheduler.js';

const createTimers = () => {
  let nextId = 1;
  const callbacks = new Map();
  return {
    callbacks,
    setTimer(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    clearTimer(id) {
      callbacks.delete(id);
    },
    run() {
      const entries = [...callbacks.entries()];
      callbacks.clear();
      entries.forEach(([, callback]) => callback());
    },
  };
};

const flushPromises = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

test('coalesces rapid refresh requests', async () => {
  const timers = createTimers();
  const applied = [];
  let loads = 0;
  const scheduler = createRefreshScheduler({
    load: async () => {
      loads += 1;
      return ['geofence'];
    },
    apply: (value) => applied.push(value),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();

  assert.equal(timers.callbacks.size, 1);
  timers.run();
  await flushPromises();

  assert.equal(loads, 1);
  assert.deepEqual(applied, [['geofence']]);
});

test('only applies the latest refresh response', async () => {
  const timers = createTimers();
  const pending = [];
  const applied = [];
  const scheduler = createRefreshScheduler({
    load: () => new Promise((resolve) => pending.push(resolve)),
    apply: (value) => applied.push(value),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  scheduler.schedule();
  timers.run();
  await flushPromises();
  scheduler.schedule();
  timers.run();
  await flushPromises();

  pending[1]('latest');
  await flushPromises();
  pending[0]('stale');
  await flushPromises();

  assert.deepEqual(applied, ['latest']);
});

test('reports current failures without applying data', async () => {
  const timers = createTimers();
  const applied = [];
  const failures = [];
  const scheduler = createRefreshScheduler({
    load: async () => {
      throw new Error('refresh failed');
    },
    apply: (value) => applied.push(value),
    fail: (error) => failures.push(error.message),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  scheduler.schedule();
  timers.run();
  await flushPromises();

  assert.deepEqual(applied, []);
  assert.deepEqual(failures, ['refresh failed']);
});

test('cancels scheduled and in-flight refreshes', async () => {
  const timers = createTimers();
  const pending = [];
  const applied = [];
  const scheduler = createRefreshScheduler({
    load: () => new Promise((resolve) => pending.push(resolve)),
    apply: (value) => applied.push(value),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  scheduler.schedule();
  scheduler.cancel();
  timers.run();
  assert.deepEqual(pending, []);

  scheduler.schedule();
  timers.run();
  await flushPromises();
  scheduler.cancel();
  pending[0]('cancelled');
  await flushPromises();

  assert.deepEqual(applied, []);
});
