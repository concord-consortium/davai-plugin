import { types, Instance } from "mobx-state-tree";
import { AssistantModel } from "./assistant-model";
import { GraphSonificationModel } from "./graph-sonification-model";
import { TransportManager } from "./transport-manager";

export const RootStore = types.model("RootStore", {
  assistantStore: AssistantModel,
  sonificationStore: GraphSonificationModel,
})
.volatile((self) => ({
  transportManager: new TransportManager(),
}));

export interface IRootStore extends Instance<typeof RootStore> {}
