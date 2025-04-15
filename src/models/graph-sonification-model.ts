import { flow, types } from "mobx-state-tree";
import { CodapItem, ICODAPGraph } from "../types";
import { getAllItems } from "@concord-consortium/codap-plugin-api";

export const GraphSonificationModel = types
  .model("GraphSonificationModel", {
    selectedGraph: types.maybe(types.frozen<ICODAPGraph>()),
    graphItems: types.maybe(types.array(types.frozen())),
  })
  .views((self) => ({
    getPrimaryBounds() {
      if (!self.selectedGraph) return undefined;
      return self.selectedGraph.primaryAxis === "y"
        ? { upperBound: self.selectedGraph.yUpperBound, lowerBound: self.selectedGraph.yLowerBound }
        : { upperBound: self.selectedGraph.xUpperBound, lowerBound: self.selectedGraph.xLowerBound };
    },
    getSecondaryBounds() {
      if (!self.selectedGraph) return;
      const { selectedGraph } = self;
      const { xUpperBound, xLowerBound, yUpperBound, yLowerBound } = selectedGraph;
      return self.selectedGraph.primaryAxis === "y"
        ? { upperBound: xUpperBound, lowerBound: xLowerBound }
        : { upperBound: yUpperBound, lowerBound: yLowerBound };
    }
  })
  )
  .views((self) => ({
    timeAttr() {
      if (!self.selectedGraph) return undefined;
      return self.selectedGraph.primaryAxis === "y" ? self.selectedGraph.yAttributeName : self.selectedGraph.xAttributeName;
    },
    pitchAttr() {
      if (!self.selectedGraph) return undefined;
      return self.selectedGraph.primaryAxis === "y" ? self.selectedGraph.xAttributeName : self.selectedGraph.yAttributeName;
    }
  }))
  .views((self => ({
    getValidItems() {
      if (!self.selectedGraph || !self.graphItems) return [];
      const timeAttr = self.timeAttr();
      const pitchAttr = self.pitchAttr();

      if (!timeAttr) return [];

      const validItems = pitchAttr && timeAttr
        ? self.graphItems.filter((item: CodapItem) => item.values[pitchAttr] !== "" && item.values[timeAttr] !== "")
        : self.graphItems.filter((item: CodapItem) => item.values[timeAttr] !== "");

      return validItems;
    }
    })
  ))
  .views((self => ({
    getTimeValues() {
      if (!self.selectedGraph || !self.graphItems) return;

      const validItems = self.getValidItems();
      const timeAttr = self.timeAttr();
      if (!timeAttr) return;

      return validItems.map((item: CodapItem) => item.values[timeAttr]);
    },
    getPitchFractions() {
      if (!self.selectedGraph || !self.graphItems) return;

      const validItems = self.getValidItems();
      const pitchAttr = self.pitchAttr();
      if (!pitchAttr) return;

      const bounds = self.getSecondaryBounds();
      if (!bounds) return;
      const { upperBound, lowerBound } = bounds;
      if (!upperBound || !lowerBound) return;

      const pitchRange = upperBound - lowerBound || 1;

      const pitchValues = validItems.map((item: CodapItem) => item.values[pitchAttr]);
      return pitchValues.map((value: number) => (value - lowerBound) / pitchRange);
    }
  })))
  .views((self) => ({
    getTimeFractions() {
      if (!self.selectedGraph || !self.graphItems) return;
      const timeAttr = self.timeAttr();
      if (!timeAttr) return;

      const bounds = self.getPrimaryBounds();
      if (!bounds) return;
      const { upperBound, lowerBound } = bounds;
      if (!upperBound || !lowerBound) return;

      const timeRange = upperBound - lowerBound || 1;
      const timeValues = self.getTimeValues() || [];
      return timeValues.map((value: number) => (value - lowerBound) / timeRange);
    }
  }))
  .actions((self) => ({
    setSelectedGraph(graph: ICODAPGraph) {
      self.selectedGraph = graph;
    },
    removeSelectedGraph() {
      self.selectedGraph = undefined;
    },
    removeGraphItems() {
      self.graphItems = undefined;
    }
  }))
  .actions((self) => {
    // we want to do this whenever the selected graph changes, or when we receive a data context change notification
    const setGraphItems = flow(function* (dataContext: string) {
      const allItemsRes = yield getAllItems(dataContext);
      const allItems = allItemsRes.values;
      self.graphItems = allItems;
    });
    return { setGraphItems };
  });

export type GraphSonificationModelType = typeof GraphSonificationModel.Type;
