import { types } from "mobx-state-tree";

export const GraphSonificationModel = types
  .model("GraphSonificationModel", {
    graphToSonify: types.optional(types.string, ""),
    graphInfo: types.optional(types.frozen(), {})
  })
  .actions((self) => ({
    setGraphToSonify(graphName: string) {
      self.graphToSonify = graphName;
    },
    setGraphInfo(graphInfo: any) {
      self.graphInfo = graphInfo;
    }
  }));

export type GraphSonificationModelType = typeof GraphSonificationModel.Type;
