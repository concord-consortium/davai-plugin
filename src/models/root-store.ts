import { types, Instance } from "mobx-state-tree";
import { AssistantModel } from "./assistant-model";
import { GraphSonificationModel } from "./graph-sonification-model";

export const RootStore = types.model("RootStore", {
  assistantStore: AssistantModel,
  sonificationStore: GraphSonificationModel,
});

export interface IRootStore extends Instance<typeof RootStore> {}
