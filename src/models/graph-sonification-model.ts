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
    validGraphs() {
      return self.allGraphs?.filter((graph: ICODAPGraph) => graph.plotType === "scatterPlot") || [];
    }
  }))
  .views((self) => ({
    getSelectedGraph() {
      return self.allGraphs.find((graph: ICODAPGraph) => graph.id === self.selectedGraphID);
    }
  }))
  .views((self) => ({
    getPrimaryBounds() {
      const selectedGraph = self.getSelectedGraph();
      if (!selectedGraph) return undefined;
      return selectedGraph.primaryAxis === "y"
        ? { upperBound: selectedGraph.yUpperBound, lowerBound: selectedGraph.yLowerBound }
        : { upperBound: selectedGraph.xUpperBound, lowerBound: selectedGraph.xLowerBound };
    },
    getSecondaryBounds() {
      const selectedGraph = self.getSelectedGraph();
      if (!selectedGraph) return undefined;
      const { xUpperBound, xLowerBound, yUpperBound, yLowerBound } = selectedGraph;
      return selectedGraph.primaryAxis === "y"
        ? { upperBound: xUpperBound, lowerBound: xLowerBound }
        : { upperBound: yUpperBound, lowerBound: yLowerBound };
    }
  })
  )
  .views((self) => ({
    timeAttr() {
      const selectedGraph = self.getSelectedGraph();
      if (!selectedGraph) return undefined;
      return selectedGraph.primaryAxis === "y" ? selectedGraph.yAttributeName : selectedGraph.xAttributeName;
    },
    pitchAttr() {
      const selectedGraph = self.getSelectedGraph();
      if (!selectedGraph) return undefined;
      return selectedGraph.primaryAxis === "y" ? selectedGraph.xAttributeName : selectedGraph.yAttributeName;
    }
  }))
  .views((self => ({
    getValidItems() {
      const selectedGraph = self.getSelectedGraph();
      if (!selectedGraph || !self.graphItems) return [];
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
      const selectedGraph = self.getSelectedGraph();
      if (!selectedGraph || !self.graphItems) return [];

      const validItems = self.getValidItems();
      const timeAttr = self.timeAttr();
      if (!timeAttr) return [];

      return validItems.map((item: CodapItem) => item.values[timeAttr]);
    },
    getPitchFractions() {
      const selectedGraph = self.getSelectedGraph();
      if (!selectedGraph || !self.graphItems) return [];

      const validItems = self.getValidItems();
      const pitchAttr = self.pitchAttr();
      if (!pitchAttr) return [];

      const bounds = self.getSecondaryBounds();
      if (!bounds) return [];
      const { upperBound, lowerBound } = bounds;
      if (!upperBound || !lowerBound) return [];

      const pitchRange = upperBound - lowerBound || 1;

      const pitchValues = validItems.map((item: CodapItem) => item.values[pitchAttr]);
      return pitchValues.map((value: number) => (value - lowerBound) / pitchRange);
    }
  })))
  .views((self) => ({
    getTimeFractions() {
      const selectedGraph = self.getSelectedGraph();
      if (!selectedGraph || !self.graphItems) return [];
      const timeAttr = self.timeAttr();
      if (!timeAttr) return [];

      const bounds = self.getPrimaryBounds();
      if (!bounds) return [];
      const { upperBound, lowerBound } = bounds;
      if (!upperBound || !lowerBound) return [];

      const timeRange = upperBound - lowerBound || 1;
      const timeValues = self.getTimeValues() || [];
      return timeValues.map((value: number) => (value - lowerBound) / timeRange);
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
      const dataContext = self.getSelectedGraph()?.dataContext;
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
          validGraphIDs: self.validGraphs().map(g => g.id)
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
