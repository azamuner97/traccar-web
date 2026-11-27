import assert from 'node:assert/strict';
import test from 'node:test';

import createSyncSignal from './syncSignal.js';

test('a request reaches every listener with its arguments until it unsubscribes', () => {
  const signal = createSyncSignal();
  const first = [];
  const second = [];
  const unsubscribeFirst = signal.listen((...args) => first.push(args));
  signal.listen((...args) => second.push(args));
  signal.request(['game-status']);
  signal.request();
  unsubscribeFirst();
  signal.request('after');
  assert.deepEqual(first, [[['game-status']], []]);
  assert.deepEqual(second, [[['game-status']], [], ['after']]);
});

test('a listener added twice runs once and one unsubscribe removes it', () => {
  const signal = createSyncSignal();
  let calls = 0;
  const listener = () => {
    calls += 1;
  };
  const unsubscribe = signal.listen(listener);
  signal.listen(listener);
  signal.request();
  assert.equal(calls, 1);
  unsubscribe();
  signal.request();
  assert.equal(calls, 1);
});

test('signals are independent', () => {
  const games = createSyncSignal();
  const notifications = createSyncSignal();
  let calls = 0;
  games.listen(() => {
    calls += 1;
  });
  notifications.request();
  assert.equal(calls, 0);
  games.request();
  assert.equal(calls, 1);
});
