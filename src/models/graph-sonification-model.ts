import { types } from "mobx-state-tree";

export const GraphSonificationModel = types
  .model("GraphSonificationModel", {
    selectedGraph: types.optional(types.frozen(), {}),
  })
  .actions((self) => ({
    setSelectedGraph(graph: Record<string, any>) {
      self.selectedGraph = graph;
    }
  }));

export type GraphSonificationModelType = typeof GraphSonificationModel.Type;
