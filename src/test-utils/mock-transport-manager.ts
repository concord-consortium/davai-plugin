import { observable } from "mobx";

export const mockTransportManager = observable({
  speed: 1,
  looping: false,
  isPlaying: false,
  isAtBeginning: true,
  playPause() {
    this.isPlaying = true;
    this.isAtBeginning = false;
  },
  setLooping(loop: boolean) {
    this.looping = loop;
  },
  setSpeed(newSpeed: number) {
    this.speed = newSpeed;
  },
  reset: jest.fn()
});
