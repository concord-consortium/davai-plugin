import { flow, types } from "mobx-state-tree";
import { reaction } from "mobx";
import { CodapItem, ICODAPGraph } from "../types";
import { getAllItems } from "@concord-consortium/codap-plugin-api";
import { removeRoiAdornment } from "../components/graph-sonification-utils";

export const GraphSonificationModel = types
  .model("GraphSonificationModel", {
    allGraphs: types.optional(types.array(types.frozen<ICODAPGraph>()), []),
    selectedGraphID: types.maybe(types.number),
    graphItems: types.maybe(types.array(types.frozen())),
  })
  .views((self) => ({
    get validGraphs() {
      return self.allGraphs?.filter((graph: ICODAPGraph) => graph.plotType === "scatterPlot") || [];
    }
  }))
  .views((self) => ({
    get selectedGraph() {
      return self.validGraphs.find((graph: ICODAPGraph) => graph.id === self.selectedGraphID);
    }
  }))
  .views((self) => ({
    get primaryBounds() {
      const selectedGraph = self.selectedGraph;
      if (!selectedGraph) return undefined;
      return selectedGraph.primaryAxis === "y"
        ? { upperBound: selectedGraph.yUpperBound, lowerBound: selectedGraph.yLowerBound }
        : { upperBound: selectedGraph.xUpperBound, lowerBound: selectedGraph.xLowerBound };
    },
    get secondaryBounds() {
      const selectedGraph = self.selectedGraph;
      if (!selectedGraph) return undefined;
      const { xUpperBound, xLowerBound, yUpperBound, yLowerBound } = selectedGraph;
      return selectedGraph.primaryAxis === "y"
        ? { upperBound: xUpperBound, lowerBound: xLowerBound }
        : { upperBound: yUpperBound, lowerBound: yLowerBound };
    },
    get timeAttr() {
      if (!self.selectedGraph) return undefined;
      return self.selectedGraph.primaryAxis === "y"
        ? self.selectedGraph.yAttributeName
        : self.selectedGraph.xAttributeName;
    },
    get pitchAttr() {
      if (!self.selectedGraph) return undefined;
      return self.selectedGraph.primaryAxis === "y"
        ? self.selectedGraph.xAttributeName
        : self.selectedGraph.yAttributeName;
    }
  }))
  .views((self => ({
    get validItems() {
      if (!self.selectedGraph || !self.graphItems || !self.timeAttr) return [];
      const timeAttr = self.timeAttr;
      const pitchAttr = self.pitchAttr;


      const validItems = pitchAttr && timeAttr
        ? self.graphItems.filter((item: CodapItem) => item.values[pitchAttr] !== "" && item.values[timeAttr] !== "")
        : self.graphItems.filter((item: CodapItem) => item.values[timeAttr] !== "");

      return validItems;
    }
    })
  ))
  .views((self => ({
    get timeValues() {
      if (!self.timeAttr) return [];

      const timeAttr = self.timeAttr;
      return self.validItems.map((item: CodapItem) => item.values[timeAttr]);
    },
    get pitchFractions() {
      if (!self.pitchAttr || !self.secondaryBounds) return [];

      const pitchAttr = self.pitchAttr;
      const bounds = self.secondaryBounds;
      const { upperBound, lowerBound } = bounds;
      if (!upperBound || !lowerBound) return [];

      const pitchRange = upperBound - lowerBound || 1;

      const pitchValues = self.validItems.map((item: CodapItem) => item.values[pitchAttr]);
      return pitchValues.map((value: number) => (value - lowerBound) / pitchRange);
    }
  })))
  .views((self) => ({
    get timeFractions() {
      if (!self.primaryBounds) return [];

      const bounds = self.primaryBounds;
      const { upperBound, lowerBound } = bounds;
      if (!upperBound || !lowerBound) return [];

      const timeRange = upperBound - lowerBound || 1;
      return self.timeValues.map((value: number) => (value - lowerBound) / timeRange);
    }
  }))
  .actions((self) => ({
    setGraphs(graphs: ICODAPGraph[]) {
      self.allGraphs.replace(graphs);
    },
    clearGraphs() {
      self.allGraphs.replace([]);
    },
    setSelectedGraphID(graphID: number) {
      // then, set the new selected graph
      self.selectedGraphID = graphID;
    },
    removeSelectedGraph() {
      self.selectedGraphID = undefined;
    },
    clearGraphItems() {
      self.graphItems = undefined;
    }
  }))
  .actions((self) => {
    // we call this function when:
    // 1. a new graph is selected for sonification
    // 2. we receive a data context change notification relevant to the selected graph
    const setGraphItems = flow(function* () {
      const dataContext = self.selectedGraph?.dataContext;
      if (!dataContext) return;
      const allItemsRes = yield getAllItems(dataContext);
      const allItems = allItemsRes.values;
      self.graphItems = allItems;
    });
    return { setGraphItems };
  })
  .actions((self) => ({
    afterCreate() {
      // clear selectedGraphID if it no longer points to a valid graph
      reaction(
        () => ({
          selectedGraphID: self.selectedGraphID,
          validGraphIDs: self.validGraphs.map(g => g.id)
        }),
        ({ selectedGraphID, validGraphIDs }) => {
          if (selectedGraphID != null && !validGraphIDs.includes(selectedGraphID)) {
            removeRoiAdornment(`${selectedGraphID}`);
            self.removeSelectedGraph();
            self.clearGraphItems();
          }
        }
      );
    }
  }));

export type GraphSonificationModelType = typeof GraphSonificationModel.Type;
