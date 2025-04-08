import { types } from "mobx-state-tree";

export const GraphSonificationModel = types
  .model("GraphSonificationModel", {
    graphToSonify: types.optional(types.string, ""),
    graphInfo: types.optional(types.frozen(), {}),
    isLooping: types.optional(types.boolean, false),
    isPlaying: types.optional(types.boolean, false),
    isPaused: types.optional(types.boolean, false),
    startFromPause: types.optional(types.boolean, false),
    timeValues: types.optional(types.array(types.number), []),
    timeFractions: types.optional(types.array(types.number), []),
    pitchFractions: types.optional(types.array(types.number), []),
    duration: types.optional(types.number, 5),
    sonifySpeed: types.optional(types.number, 1),
  })
  .actions((self) => ({
    setGraphToSonify(graphName: string) {
      self.graphToSonify = graphName;
    },
    setGraphInfo(graphInfo: any) {
      self.graphInfo = graphInfo;
    },
    setIsPlaying(isPlaying: boolean) {
      self.isPlaying = isPlaying;
    },
    setIsPaused(isPaused: boolean) {
      self.isPaused = isPaused;
    },
    setStartFromPause(startFromPause: boolean) {
      self.startFromPause = startFromPause;
    },
    setIsLooping(isLooping: boolean) {
      self.isLooping = isLooping;
    },
    setSpeed(speed: number) {
      self.sonifySpeed = speed;
    },
    setTimeValues(timeValues: number[]) {
      self.timeValues.replace(timeValues);
    },
    setTimeFractions(timeFractions: number[]) {
      self.timeFractions.replace(timeFractions);
    },
    setPitchFractions(pitchValues: number[]) {
      self.pitchFractions.replace(pitchValues);
    },
    handlePlayEnd() {
      self.isPlaying = false;
      self.isPaused = false;
      self.startFromPause = false;
    }
  }));

export type GraphSonificationModelType = typeof GraphSonificationModel.Type;
