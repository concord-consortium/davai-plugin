/**
 * Mock implementations for Web Speech API (speechSynthesis) for testing.
 */

export class MockSpeechSynthesisUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  volume = 1;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  onstart: ((event: Event) => void) | null = null;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onpause: ((event: Event) => void) | null = null;
  onresume: ((event: Event) => void) | null = null;
  onmark: ((event: Event) => void) | null = null;
  onboundary: ((event: Event) => void) | null = null;

  constructor(text?: string) {
    this.text = text || "";
  }

  addEventListener() {
    // Mock implementation
  }

  removeEventListener() {
    // Mock implementation
  }

  dispatchEvent(): boolean {
    return true;
  }
}

export interface MockSpeechSynthesis {
  speaking: boolean;
  pending: boolean;
  paused: boolean;
  speak: jest.Mock;
  cancel: jest.Mock;
  pause: jest.Mock;
  resume: jest.Mock;
  getVoices: jest.Mock;
  onvoiceschanged: (() => void) | null;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
  dispatchEvent: jest.Mock;
}

export const createMockSpeechSynthesis = (): MockSpeechSynthesis => ({
  speaking: false,
  pending: false,
  paused: false,
  speak: jest.fn(),
  cancel: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  getVoices: jest.fn(() => []),
  onvoiceschanged: null,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  dispatchEvent: jest.fn(() => true),
});

export const setupMockSpeechSynthesis = (): MockSpeechSynthesis => {
  const mockSpeechSynthesis = createMockSpeechSynthesis();

  Object.defineProperty(window, "speechSynthesis", {
    value: mockSpeechSynthesis,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: MockSpeechSynthesisUtterance,
    writable: true,
    configurable: true,
  });

  return mockSpeechSynthesis;
};

export const cleanupMockSpeechSynthesis = (): void => {
  // Reset to undefined to simulate environments without speech synthesis
  Object.defineProperty(window, "speechSynthesis", {
    value: undefined,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: undefined,
    writable: true,
    configurable: true,
  });
};
