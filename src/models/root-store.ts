import { types, Instance } from "mobx-state-tree";
import { AssistantModel } from "./assistant-model";
import { GraphSonificationModel } from "./graph-sonification-model";

export const RootStore = types.model("RootStore", {
  assistantStore: AssistantModel,
  sonificationStore: GraphSonificationModel,
});

export function createRootStore() {
  return RootStore.create({
    assistantStore: AssistantModel.create({
      transcriptStore: {},
      dataContexts: [],
      selectedDataContext: "",
      selectedDataContextInfo: {},
      dataContextItems: [],
      dataContextNames: [],
      dataContextAttributes: [],
      dataContextAttributeValues: [],
      dataContextAttributeTypes: [],
      dataContextAttributeNames: [],
      dataContextAttributeDescriptions: []
    }),
    sonificationStore: GraphSonificationModel.create({
      allGraphs: [],
      selectedGraphID: undefined,
      graphItems: undefined,
      binValues: {}
    })
  });
}

export interface IRootStore extends Instance<typeof RootStore> {}
