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
  })),
  Oscillator: jest.fn(() => ({
    connect: jest.fn(),
    rampTo: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  })),
  Panner: jest.fn(() => ({
    toDestination: jest.fn(),
  })),
  Gain: jest.fn(() => ({
    connect: jest.fn(),
    rampTo: jest.fn(),
    gain: jest.fn(() => ({
      rampTo: jest.fn()
    })),
  })),
  start: jest.fn(),
  stop: jest.fn(),

};
