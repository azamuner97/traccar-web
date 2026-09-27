import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLICK_SUPPRESSION_WINDOW,
  LONG_PRESS_DELAY,
  copyText,
  createLongPressController,
  formatCoordinates,
} from './coordinateSelection.js';

const createScheduler = () => {
  let callback;
  let cancelled = false;
  return {
    schedule: (nextCallback, delay) => {
      assert.equal(delay, LONG_PRESS_DELAY);
      callback = nextCallback;
      cancelled = false;
      return 1;
    },
    unschedule: () => {
      cancelled = true;
    },
    run: () => {
      if (!cancelled) {
        callback?.();
      }
    },
  };
};

test('formats coordinates as latitude and longitude with six decimals', () => {
  assert.equal(formatCoordinates(47.3768866, 8.5416944), '47.376887, 8.541694');
  assert.equal(formatCoordinates(-33.865143, -151.2099), '-33.865143, -151.209900');
  assert.equal(formatCoordinates(-0.0000001, 0), '0.000000, 0.000000');
});

const createDocument = ({ copied = true } = {}) => {
  const operations = [];
  const textArea = {
    style: {},
    setAttribute: (name, value) => operations.push(['attribute', name, value]),
    select: () => operations.push(['select']),
    setSelectionRange: (start, end) => operations.push(['range', start, end]),
  };
  return {
    documentObject: {
      activeElement: { focus: () => operations.push(['focus']) },
      createElement: (name) => {
        operations.push(['create', name]);
        return textArea;
      },
      body: {
        appendChild: () => operations.push(['append']),
        removeChild: () => operations.push(['remove']),
      },
      execCommand: (command) => {
        operations.push(['command', command]);
        return copied;
      },
    },
    operations,
    textArea,
  };
};

test('copies with the asynchronous Clipboard API when available', async () => {
  const values = [];
  await copyText('47.376887, 8.541694', {
    clipboard: { writeText: async (value) => values.push(value) },
  });
  assert.deepEqual(values, ['47.376887, 8.541694']);
});

test('falls back to a selected textarea when the Clipboard API is unavailable', async () => {
  const { documentObject, operations, textArea } = createDocument();
  await copyText('47.376887, 8.541694', { clipboard: undefined, documentObject });

  assert.equal(textArea.value, '47.376887, 8.541694');
  assert.deepEqual(operations, [
    ['create', 'textarea'],
    ['attribute', 'readonly', ''],
    ['append'],
    ['select'],
    ['range', 0, 19],
    ['command', 'copy'],
    ['remove'],
    ['focus'],
  ]);
});

test('uses the fallback after a Clipboard API rejection', async () => {
  const { documentObject, operations } = createDocument();
  await copyText('coordinates', {
    clipboard: { writeText: async () => Promise.reject(new Error('Denied')) },
    documentObject,
  });
  assert.equal(
    operations.some(([operation, value]) => operation === 'command' && value === 'copy'),
    true,
  );
});

test('reports the Clipboard API error when both copy mechanisms fail', async () => {
  const { documentObject } = createDocument({ copied: false });
  await assert.rejects(
    copyText('coordinates', {
      clipboard: { writeText: async () => Promise.reject(new Error('Denied')) },
      documentObject,
    }),
    /Denied/,
  );
});

test('opens after a stationary single-finger long press', () => {
  const scheduler = createScheduler();
  const values = [];
  const controller = createLongPressController({
    onLongPress: (value) => values.push(value),
    schedule: scheduler.schedule,
    unschedule: scheduler.unschedule,
  });

  assert.equal(controller.start([{ x: 10, y: 20 }], 'initial'), true);
  assert.equal(controller.move([{ x: 16, y: 26 }], 'latest'), true);
  scheduler.run();

  assert.deepEqual(values, ['latest']);
});

test('cancels before the delay on release, movement, multi-touch, or cancellation', () => {
  for (const cancelGesture of [
    (controller) => controller.end(),
    (controller) => controller.move([{ x: 21, y: 20 }], 'moved'),
    (controller) =>
      controller.start(
        [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
        ],
        'multi',
      ),
    (controller) => controller.cancel(),
  ]) {
    const scheduler = createScheduler();
    let triggered = false;
    const controller = createLongPressController({
      onLongPress: () => {
        triggered = true;
      },
      schedule: scheduler.schedule,
      unschedule: scheduler.unschedule,
    });
    controller.start([{ x: 10, y: 20 }], 'initial');
    cancelGesture(controller);
    scheduler.run();
    assert.equal(triggered, false);
  }
});

test('suppresses only the first synthetic click after a completed long press', () => {
  const scheduler = createScheduler();
  let currentTime = 100;
  const controller = createLongPressController({
    onLongPress: () => {},
    schedule: scheduler.schedule,
    unschedule: scheduler.unschedule,
    now: () => currentTime,
  });

  controller.start([{ x: 10, y: 20 }], 'initial');
  scheduler.run();
  controller.end();

  assert.equal(controller.consumeSuppressedClick(), true);
  assert.equal(controller.consumeSuppressedClick(), false);

  controller.start([{ x: 10, y: 20 }], 'initial');
  scheduler.run();
  controller.end();
  currentTime += CLICK_SUPPRESSION_WINDOW + 1;
  assert.equal(controller.consumeSuppressedClick(), false);
});
