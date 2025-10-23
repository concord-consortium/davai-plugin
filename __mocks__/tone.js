module.exports = {
  getTransport: jest.fn(() => ({
    cancel: jest.fn(),
    pause: jest.fn(),
    scheduleOnce: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  })),
  PolySynth : jest.fn(() => ({
    connect: jest.fn(),
    triggerAttackRelease: jest.fn(),
    toDestination: jest.fn(),
    dispose: jest.fn(),
  })),
  Oscillator: jest.fn(() => ({
    connect: jest.fn(),
    rampTo: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    dispose: jest.fn(),
    sync: jest.fn(() => ({
      start: jest.fn(),
      stop: jest.fn(),
    })),
  })),
  Panner: jest.fn(() => ({
    toDestination: jest.fn(),
    dispose: jest.fn(),
  })),
  Part: jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    dispose: jest.fn(),
  })),
  start: jest.fn(),
  stop: jest.fn(),
};
