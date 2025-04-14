import { types } from "mobx-state-tree";
import { ICODAPGraph } from "../types";

export const GraphSonificationModel = types
  .model("GraphSonificationModel", {
    selectedGraph: types.maybe(types.frozen<ICODAPGraph>()),
  })
  .actions((self) => ({
    setSelectedGraph(graph: ICODAPGraph) {
      self.selectedGraph = graph;
    },
    removeSelectedGraph() {
      self.selectedGraph = undefined;
    }
  }));

export type GraphSonificationModelType = typeof GraphSonificationModel.Type;
