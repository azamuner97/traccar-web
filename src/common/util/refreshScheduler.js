const createRefreshScheduler = ({
  load,
  apply,
  fail = () => {},
  delay = 250,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) => {
  let timer = null;
  let revision = 0;

  const execute = (currentRevision) => {
    timer = null;
    Promise.resolve()
      .then(load)
      .then((value) => {
        if (revision === currentRevision) {
          apply(value);
        }
      })
      .catch((error) => {
        if (revision === currentRevision) {
          fail(error);
        }
      });
  };

  const schedule = () => {
    revision += 1;
    if (timer !== null) {
      clearTimer(timer);
    }
    const currentRevision = revision;
    timer = setTimer(() => execute(currentRevision), delay);
  };

  const cancel = () => {
    revision += 1;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  return { schedule, cancel };
};

export default createRefreshScheduler;
