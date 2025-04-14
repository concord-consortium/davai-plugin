module.exports = {
  PolySynth : jest.fn(() => ({
    connect: jest.fn(),
    triggerAttackRelease: jest.fn(),
    toDestination: jest.fn(),
  })),
  MonoSynth: jest.fn(() => ({
    connect: jest.fn(),
    triggerAttackRelease: jest.fn(),
    toDestination: jest.fn(),
  })),
  Panner: jest.fn(() => ({
    toDestination: jest.fn(),
  })),
  getTransport: jest.fn(() => ({
    start: jest.fn(),
    pause: jest.fn(),
    stop: jest.fn(),
    scheduleOnce: jest.fn(),
  })),
  start: jest.fn(),
  stop: jest.fn(),

};
