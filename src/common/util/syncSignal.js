/**
 * A refresh signal: `request(...args)` calls every listener with the arguments, `listen(listener)` adds a
 * listener (once, however often it is added) and returns the function that removes it.
 */
const createSyncSignal = () => {
  const listeners = new Set();
  return {
    request: (...args) => listeners.forEach((listener) => listener(...args)),
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export default createSyncSignal;
