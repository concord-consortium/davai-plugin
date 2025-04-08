import { types, Instance } from "mobx-state-tree";
import { AssistantModel } from "./assistant-model";
import { GraphSonificationModel } from "./graph-sonification-model";

export const RootStore = types.model("RootStore", {
  assistantStore: AssistantModel,
  sonificationStore: GraphSonificationModel,
});

export function createRootStore() {
  return RootStore.create({
    assistantStore: {
      assistantId: "mock",
    },
    sonificationStore: {
      graphToSonify: "",
      isSonificationPlaying: false
    }
  });
}

export interface IRootStore extends Instance<typeof RootStore> {}
