import assert from 'node:assert/strict';
import test from 'node:test';
import { drawingsActions, drawingsReducer } from './drawings.js';

test('drawing state refreshes, upserts, and removes items', () => {
  let state = drawingsReducer(undefined, { type: 'init' });
  state = drawingsReducer(
    state,
    drawingsActions.refresh([
      { id: 1, color: '#FF0000' },
      { id: 2, color: '#00FF00' },
    ]),
  );
  assert.deepEqual(Object.keys(state.items), ['1', '2']);

  state = drawingsReducer(state, drawingsActions.upsert({ id: 1, color: '#0000FF' }));
  assert.equal(state.items[1].color, '#0000FF');

  state = drawingsReducer(state, drawingsActions.remove(2));
  assert.deepEqual(Object.keys(state.items), ['1']);

  state = drawingsReducer(state, drawingsActions.refresh([]));
  assert.deepEqual(state.items, {});
});
