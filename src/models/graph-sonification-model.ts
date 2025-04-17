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
    get isYPrimary() {
      return self.selectedGraph?.primaryAxis === "y" && self.selectedGraph?.plotType !== "scatterPlot"; // for scatterplot graphs, x is always considered primary
    }
  }))
  .views((self) => ({
    get primaryBounds() {
      return self.isYPrimary
        ? { upperBound: self.selectedGraph?.yUpperBound, lowerBound: self.selectedGraph?.yLowerBound }
        : { upperBound: self.selectedGraph?.xUpperBound, lowerBound: self.selectedGraph?.xLowerBound };
    },
    get secondaryBounds() {
      return self.isYPrimary
        ? { upperBound: self.selectedGraph?.xUpperBound, lowerBound: self.selectedGraph?.xLowerBound }
        : { upperBound: self.selectedGraph?.yUpperBound, lowerBound: self.selectedGraph?.yLowerBound };
    },
    get timeAttr() {
      return self.isYPrimary
        ? self.selectedGraph?.yAttributeName
        : self.selectedGraph?.xAttributeName;
    },
    get pitchAttr() {
      return self.isYPrimary
        ? self.selectedGraph?.xAttributeName
        : self.selectedGraph?.yAttributeName;
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
      if (!self.pitchAttr) return [];

      const bounds = self.secondaryBounds;
      const { upperBound, lowerBound } = bounds;
      if (!upperBound || !lowerBound) return [];

      const pitchRange = upperBound - lowerBound || 1;
      const pitchAttr = self.pitchAttr;
      const pitchValues = self.validItems.map((item: CodapItem) => item.values[pitchAttr]);
      return pitchValues.map((value: number) => (value - lowerBound) / pitchRange);
    }
  })))
  .views((self) => ({
    get timeFractions() {
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
      self.selectedGraphID = graphID;
    },
    removeSelectedGraphID() {
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
          if (selectedGraphID !== undefined && !validGraphIDs.includes(selectedGraphID)) {
            removeRoiAdornment(`${selectedGraphID}`);
            self.removeSelectedGraphID();
            self.clearGraphItems();
          }
        }
      );
    }
  }));

export type GraphSonificationModelType = typeof GraphSonificationModel.Type;
