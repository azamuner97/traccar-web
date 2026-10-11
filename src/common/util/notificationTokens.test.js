import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addNotificationToken,
  notificationTokens,
  removeNotificationToken,
} from './notificationTokens.js';

test('every registered phone survives adding fourth and later phones', () => {
  assert.equal(addNotificationToken('one,two,three', 'four'), 'one,two,three,four');
  assert.equal(addNotificationToken('one,two,three,four', 'five'), 'one,two,three,four,five');
});

test('token registration is normalized and idempotent', () => {
  assert.deepEqual(notificationTokens(' one, two two, ,three '), ['one', 'two', 'three']);
  assert.equal(addNotificationToken('one,two', 'two'), 'one,two');
  assert.equal(addNotificationToken(undefined, 'one'), 'one');
});

test('logout removes only this phone, including the last token', () => {
  assert.equal(removeNotificationToken('one,two,three,four', 'two'), 'one,three,four');
  assert.equal(removeNotificationToken('one', 'one'), '');
  assert.equal(removeNotificationToken(undefined, 'one'), '');
});
