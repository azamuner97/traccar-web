export const LONG_PRESS_DELAY = 500;
export const LONG_PRESS_TOLERANCE = 10;
export const CLICK_SUPPRESSION_WINDOW = 1000;

const distance = (first, second) => Math.hypot(second.x - first.x, second.y - first.y);

export const formatCoordinates = (latitude, longitude) => {
  const normalize = (value) => (Math.abs(value) < 0.0000005 ? 0 : value);
  return `${normalize(latitude).toFixed(6)}, ${normalize(longitude).toFixed(6)}`;
};

const legacyCopyText = (value, documentObject) => {
  const activeElement = documentObject.activeElement;
  const textArea = documentObject.createElement('textarea');
  textArea.value = value;
  textArea.setAttribute('readonly', '');
  Object.assign(textArea.style, {
    position: 'fixed',
    left: '-9999px',
    opacity: '0',
    pointerEvents: 'none',
  });
  documentObject.body.appendChild(textArea);
  textArea.select();
  textArea.setSelectionRange(0, value.length);
  try {
    return documentObject.execCommand('copy');
  } finally {
    documentObject.body.removeChild(textArea);
    activeElement?.focus?.();
  }
};

export const copyText = async (value, options = {}) => {
  const clipboard = Object.hasOwn(options, 'clipboard') ? options.clipboard : navigator.clipboard;
  let clipboardError;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }
  const documentObject = options.documentObject || document;
  try {
    if (!legacyCopyText(value, documentObject)) {
      throw new Error();
    }
  } catch (error) {
    throw clipboardError || error;
  }
};

export const createLongPressController = ({
  onLongPress,
  delay = LONG_PRESS_DELAY,
  tolerance = LONG_PRESS_TOLERANCE,
  suppressionWindow = CLICK_SUPPRESSION_WINDOW,
  schedule = setTimeout,
  unschedule = clearTimeout,
  now = Date.now,
}) => {
  let timeoutId;
  let gesture;
  let suppressClickUntil = 0;

  const clearGesture = () => {
    if (timeoutId !== undefined) {
      unschedule(timeoutId);
      timeoutId = undefined;
    }
    gesture = undefined;
  };

  const start = (points, value) => {
    clearGesture();
    if (points.length !== 1) {
      return false;
    }
    gesture = {
      startPoint: points[0],
      value,
      triggered: false,
    };
    timeoutId = schedule(() => {
      timeoutId = undefined;
      if (gesture) {
        gesture.triggered = true;
        onLongPress(gesture.value);
      }
    }, delay);
    return true;
  };

  const move = (points, value) => {
    if (!gesture) {
      return false;
    }
    if (points.length !== 1 || distance(gesture.startPoint, points[0]) > tolerance) {
      clearGesture();
      return false;
    }
    gesture.value = value;
    return true;
  };

  const end = () => {
    if (gesture?.triggered) {
      suppressClickUntil = now() + suppressionWindow;
    }
    clearGesture();
  };

  const consumeSuppressedClick = () => {
    if (suppressClickUntil && now() <= suppressClickUntil) {
      suppressClickUntil = 0;
      return true;
    }
    suppressClickUntil = 0;
    return false;
  };

  return {
    start,
    move,
    end,
    cancel: clearGesture,
    consumeSuppressedClick,
    dispose: clearGesture,
  };
};
