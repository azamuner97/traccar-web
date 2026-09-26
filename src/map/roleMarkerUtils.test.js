import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRoleMarker, roleNumberTextSize } from './roleMarkerUtils.js';

const device = (role, number, category = 'person') => ({
  category,
  attributes: {
    traccarToolRole: role,
    ...(number !== undefined ? { traccarToolRoleNumber: number } : {}),
  },
});

test('resolves every supported role from the new attribute contract', () => {
  for (const role of ['player', 'supporter', 'hunter']) {
    assert.deepEqual(resolveRoleMarker(device(role, 7)), {
      role,
      number: '7',
      image: `role-${role}`,
      textSize: 15,
    });
  }
});

test('accepts positive integer strings and numbers above the legacy SVG range', () => {
  assert.equal(resolveRoleMarker(device('player', ' 27 ')).number, '27');
  assert.equal(resolveRoleMarker(device('hunter', 1234)).number, '1234');
  assert.equal(resolveRoleMarker(device('supporter', '00016')).number, '16');
});

test('requires the role-number attribute even when the device category is numeric', () => {
  assert.equal(resolveRoleMarker(device('player', undefined, '15')), null);
  assert.equal(resolveRoleMarker(device('player', '', '15')), null);
});

test('rejects invalid roles and non-positive whole numbers', () => {
  assert.equal(resolveRoleMarker(device('spectator', 1)), null);
  for (const number of [0, -1, 1.5, '0', '-1', '1.5', '', null, Number.NaN]) {
    assert.equal(resolveRoleMarker(device('player', number)), null);
  }
});

test('scales longer labels down without becoming unreadably small', () => {
  assert.equal(roleNumberTextSize('1'), 15);
  assert.ok(roleNumberTextSize('123') < roleNumberTextSize('1'));
  assert.equal(roleNumberTextSize('123456789'), 6);
});
